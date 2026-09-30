import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';

class TransferScreen extends StatefulWidget {
  const TransferScreen({super.key});
  @override
  State<TransferScreen> createState() => _TransferScreenState();
}

class _TransferScreenState extends State<TransferScreen> {
  int? _fromId;
  final _toQuery = TextEditingController(text: '000000002');
  final _amountCtrl = TextEditingController(text: '5000');
  final _noteCtrl = TextEditingController(text: 'Pivosacc mobile transfer');
  List<PeerClient> _peers = [];
  PeerClient? _peer;
  List<SavingsAccount> _peerSavings = [];
  int? _toAccountId;
  bool _searching = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final sav = context.read<AppState>().bundle?.savings;
      if (sav != null && sav.isNotEmpty) setState(() => _fromId = sav.first.id);
      _search();
    });
  }

  @override
  void dispose() {
    _toQuery.dispose();
    _amountCtrl.dispose();
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    setState(() => _searching = true);
    try {
      final peers = await context.read<AppState>().api.searchClients(_toQuery.text);
      setState(() {
        _peers = peers;
        _peer = peers.isNotEmpty ? peers.first : null;
      });
      if (_peer != null) await _loadPeerSavings(_peer!);
    } catch (e) {
      if (mounted) showToast(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _loadPeerSavings(PeerClient peer) async {
    try {
      final list = await context.read<AppState>().api.getClientSavings(peer.id);
      setState(() {
        _peerSavings = list;
        _toAccountId = list.isNotEmpty ? list.first.id : null;
      });
    } catch (e) {
      if (mounted) showToast(context, e.toString(), error: true);
    }
  }

  Future<void> _send() async {
    final amt = double.tryParse(_amountCtrl.text.replaceAll(RegExp(r'[^\d.]'), '')) ?? 0;
    if (_fromId == null || _peer == null || _toAccountId == null) {
      showToast(context, 'Select from/to accounts', error: true);
      return;
    }
    if (amt <= 0) {
      showToast(context, 'Enter a valid amount', error: true);
      return;
    }
    setState(() => _busy = true);
    HapticFeedback.mediumImpact();
    final state = context.read<AppState>();
    try {
      await state.api.accountTransfer(
        fromAccountId: _fromId!,
        toClientId: _peer!.id,
        toAccountId: _toAccountId!,
        toOfficeId: _peer!.officeId,
        amount: amt,
        description: _noteCtrl.text.trim(),
      );
      await state.refreshBundle();
      if (mounted) showToast(context, 'Transfer sent: UGX ${amt.round()} → ${_peer!.displayName}');
    } catch (e) {
      if (mounted) showToast(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final savings = context.watch<AppState>().bundle?.savings ?? [];
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        const PageHeader('Transfer',
            subtitle: 'Move money between your savings or to another member. Live via Fineract account transfers.'),
        if (savings.isNotEmpty)
          DropdownButtonFormField<int>(
            value: _fromId ?? savings.first.id,
            decoration: const InputDecoration(labelText: 'From savings'),
            items: savings
                .map((s) => DropdownMenuItem(value: s.id, child: Text(s.label, overflow: TextOverflow.ellipsis)))
                .toList(),
            onChanged: (v) => setState(() => _fromId = v),
          ),
        const SizedBox(height: 12),
        TextField(
          controller: _toQuery,
          decoration: InputDecoration(
            labelText: 'To member (account / name / id)',
            suffixIcon: IconButton(
              icon: _searching
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.search),
              onPressed: _searching ? null : _search,
            ),
          ),
          onSubmitted: (_) => _search(),
        ),
        if (_peers.isNotEmpty) ...[
          const SizedBox(height: 8),
          DropdownButtonFormField<PeerClient>(
            value: _peer,
            decoration: const InputDecoration(labelText: 'Recipient'),
            items: _peers
                .map((p) => DropdownMenuItem(
                      value: p,
                      child: Text('${p.displayName} · ${p.accountNo}', overflow: TextOverflow.ellipsis),
                    ))
                .toList(),
            onChanged: (p) async {
              if (p == null) return;
              setState(() => _peer = p);
              await _loadPeerSavings(p);
            },
          ),
        ],
        if (_peerSavings.isNotEmpty) ...[
          const SizedBox(height: 12),
          DropdownButtonFormField<int>(
            value: _toAccountId ?? _peerSavings.first.id,
            decoration: const InputDecoration(labelText: 'To savings'),
            items: _peerSavings
                .map((s) => DropdownMenuItem(
                      value: s.id,
                      child: Text('${s.productName} · ${s.accountNo}', overflow: TextOverflow.ellipsis),
                    ))
                .toList(),
            onChanged: (v) => setState(() => _toAccountId = v),
          ),
        ],
        const SizedBox(height: 12),
        TextField(
          controller: _amountCtrl,
          decoration: const InputDecoration(labelText: 'Amount (UGX)'),
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        ),
        const SizedBox(height: 12),
        TextField(controller: _noteCtrl, decoration: const InputDecoration(labelText: 'Note')),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : _send,
          child: _busy
              ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Send transfer'),
        ),
        const SizedBox(height: 8),
        const Text(
          'Uses Fineract POST /accounttransfers. Demo peer: 000000002 (Okello James).',
          style: TextStyle(fontSize: 11, color: Colors.black54),
        ),
      ],
    );
  }
}
