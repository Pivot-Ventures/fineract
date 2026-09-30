import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

enum _TransferMode { otherMember, ownAccounts }
enum _TransferStep { form, confirm, success }

class TransferScreen extends StatefulWidget {
  const TransferScreen({super.key});
  @override
  State<TransferScreen> createState() => _TransferScreenState();
}

class _TransferScreenState extends State<TransferScreen> {
  _TransferMode _mode = _TransferMode.otherMember;
  _TransferStep _step = _TransferStep.form;

  int? _fromId;
  int? _toOwnId;
  final _toQuery = TextEditingController();
  final _amountCtrl = TextEditingController(text: '5000');
  final _noteCtrl = TextEditingController(text: 'Pivosacc mobile transfer');

  List<PeerClient> _peers = [];
  PeerClient? _peer;
  List<SavingsAccount> _peerSavings = [];
  int? _toPeerAccountId;
  bool _searching = false;
  bool _busy = false;
  String? _lastRef;
  double _lastAmount = 0;

  static const _chips = [1000, 5000, 10000, 25000];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final sav = context.read<AppState>().bundle?.savings ?? [];
      if (sav.isNotEmpty) {
        setState(() {
          _fromId = sav.first.id;
          if (sav.length > 1) _toOwnId = sav[1].id;
        });
      }
    });
  }

  @override
  void dispose() {
    _toQuery.dispose();
    _amountCtrl.dispose();
    _noteCtrl.dispose();
    super.dispose();
  }

  SavingsAccount? _findSav(List<SavingsAccount> list, int? id) {
    if (id == null) return null;
    for (final s in list) {
      if (s.id == id) return s;
    }
    return list.isEmpty ? null : list.first;
  }

  double get _amount {
    return double.tryParse(_amountCtrl.text.replaceAll(RegExp(r'[^\d.]'), '')) ?? 0;
  }

  Future<void> _search() async {
    final q = _toQuery.text.trim();
    if (q.isEmpty) {
      showToast(context, 'Enter member account or name', warn: true);
      return;
    }
    setState(() => _searching = true);
    try {
      final peers = await context.read<AppState>().api.searchClients(q);
      setState(() {
        _peers = peers;
        _peer = peers.isNotEmpty ? peers.first : null;
        _peerSavings = [];
        _toPeerAccountId = null;
      });
      if (_peer != null) {
        await _loadPeerSavings(_peer!);
      } else if (mounted) {
        showToast(context, 'No member found', warn: true);
      }
    } catch (e) {
      if (mounted) showToast(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _loadPeerSavings(PeerClient peer) async {
    try {
      final list = await context.read<AppState>().api.getClientSavings(peer.id);
      if (!mounted) return;
      setState(() {
        _peerSavings = list;
        _toPeerAccountId = list.isNotEmpty ? list.first.id : null;
      });
    } catch (e) {
      if (mounted) showToast(context, e.toString(), error: true);
    }
  }

  void _swapOwn() {
    if (_fromId == null || _toOwnId == null) return;
    HapticFeedback.selectionClick();
    setState(() {
      final a = _fromId;
      _fromId = _toOwnId;
      _toOwnId = a;
    });
  }

  bool _validateForm(List<SavingsAccount> savings) {
    if (_fromId == null) {
      showToast(context, 'Select from account', error: true);
      return false;
    }
    if (_amount <= 0) {
      showToast(context, 'Enter a valid amount', error: true);
      return false;
    }
    if (_mode == _TransferMode.otherMember) {
      if (_peer == null || _toPeerAccountId == null) {
        showToast(context, 'Find and select a member', error: true);
        return false;
      }
    } else {
      if (_toOwnId == null) {
        showToast(context, 'Select destination account', error: true);
        return false;
      }
      if (_fromId == _toOwnId) {
        showToast(context, 'From and to must differ', error: true);
        return false;
      }
    }
    final from = _findSav(savings, _fromId);
    if (from != null && _amount > from.available) {
      showToast(context, 'Amount exceeds available balance', warn: true);
      // still allow continue — Fineract will reject if needed
    }
    return true;
  }

  void _continue(List<SavingsAccount> savings) {
    if (!_validateForm(savings)) return;
    HapticFeedback.selectionClick();
    setState(() => _step = _TransferStep.confirm);
  }

  Future<void> _confirmSend() async {
    final state = context.read<AppState>();
    final session = state.session;
    if (session == null) return;
    setState(() => _busy = true);
    HapticFeedback.mediumImpact();
    try {
      final amt = _amount;
      dynamic res;
      if (_mode == _TransferMode.otherMember) {
        res = await state.api.accountTransfer(
          fromAccountId: _fromId!,
          toClientId: _peer!.id,
          toAccountId: _toPeerAccountId!,
          toOfficeId: _peer!.officeId,
          amount: amt,
          description: _noteCtrl.text.trim(),
        );
      } else {
        res = await state.api.accountTransfer(
          fromAccountId: _fromId!,
          toClientId: session.clientId,
          toAccountId: _toOwnId!,
          toOfficeId: session.officeId,
          fromClientId: session.clientId,
          amount: amt,
          description: _noteCtrl.text.trim().isEmpty
              ? 'Pivosacc own-account transfer'
              : _noteCtrl.text.trim(),
        );
      }
      await state.refreshBundle();
      String ref = 'TXN-${DateTime.now().millisecondsSinceEpoch % 100000000}';
      if (res is Map && res['resourceId'] != null) {
        ref = 'TXN-${res['resourceId']}';
      }
      if (!mounted) return;
      setState(() {
        _lastAmount = amt;
        _lastRef = ref;
        _busy = false;
        _step = _TransferStep.success;
      });
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showToast(context, e.toString(), error: true);
      }
    }
  }

  void _done() {
    HapticFeedback.selectionClick();
    setState(() {
      _step = _TransferStep.form;
      _amountCtrl.text = '5000';
      _noteCtrl.text = 'Pivosacc mobile transfer';
      _lastRef = null;
    });
  }

  Future<void> _pickFrom(List<SavingsAccount> savings) async {
    final picked = await _showAccountSheet(savings, selectedId: _fromId, title: 'From account');
    if (picked != null) setState(() => _fromId = picked);
  }

  Future<void> _pickToOwn(List<SavingsAccount> savings) async {
    final options = savings.where((s) => s.id != _fromId).toList();
    final picked = await _showAccountSheet(options, selectedId: _toOwnId, title: 'To account');
    if (picked != null) setState(() => _toOwnId = picked);
  }

  Future<int?> _showAccountSheet(List<SavingsAccount> savings, {int? selectedId, required String title}) {
    return showModalBottomSheet<int>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(color: const Color(0xFFD2D5DB), borderRadius: BorderRadius.circular(2)),
                ),
              ),
              const SizedBox(height: 12),
              Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 8),
              for (final s in savings)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: CircleAvatar(
                    backgroundColor: PivoColors.accent.withValues(alpha: 0.12),
                    child: const Icon(Icons.savings_outlined, color: PivoColors.accent, size: 20),
                  ),
                  title: Text(s.productName, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                  subtitle: Text('${s.accountNo} · ${fmtMoney(s.available, s.currency)}',
                      style: const TextStyle(fontSize: 11.5, color: PivoColors.muted)),
                  trailing: selectedId == s.id
                      ? const Icon(Icons.check_circle_rounded, color: PivoColors.accent)
                      : null,
                  onTap: () => Navigator.pop(ctx, s.id),
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final savings = state.bundle?.savings ?? [];
    final from = _findSav(savings, _fromId);
    final toOwn = _findSav(savings, _toOwnId);

    if (_step == _TransferStep.confirm) {
      return _ConfirmView(
        mode: _mode,
        amount: _amount,
        note: _noteCtrl.text.trim(),
        from: from,
        toOwn: toOwn,
        peer: _peer,
        peerSavings: _peerSavings,
        toPeerAccountId: _toPeerAccountId,
        busy: _busy,
        onBack: () => setState(() => _step = _TransferStep.form),
        onConfirm: _confirmSend,
      );
    }
    if (_step == _TransferStep.success) {
      return _SuccessView(
        amount: _lastAmount,
        ref: _lastRef ?? '—',
        note: _noteCtrl.text.trim(),
        from: from,
        toOwn: toOwn,
        peer: _peer,
        peerSavings: _peerSavings,
        toPeerAccountId: _toPeerAccountId,
        mode: _mode,
        onDone: _done,
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
      children: [
        const Text('Send money', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 4),
        const Text(
          'Between your accounts or to another member.',
          style: TextStyle(color: PivoColors.muted, fontSize: 12),
        ),
        const SizedBox(height: 12),
        _ModeToggle(
          mode: _mode,
          onChanged: (m) {
            HapticFeedback.selectionClick();
            setState(() => _mode = m);
          },
        ),
        const SizedBox(height: 14),
        const _FieldLabel('From'),
        _AccountTile(
          title: from?.productName ?? 'Select account',
          subtitle: from == null
              ? 'Tap to choose'
              : 'A/C ${from.accountNo} · ${fmtMoney(from.available, from.currency)}',
          accent: PivoColors.accent,
          onTap: savings.isEmpty ? null : () => _pickFrom(savings),
        ),
        if (_mode == _TransferMode.ownAccounts) ...[
          const SizedBox(height: 8),
          Center(
            child: Material(
              color: Colors.white,
              shape: const CircleBorder(),
              elevation: 1,
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: _swapOwn,
                child: Container(
                  width: 40,
                  height: 40,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: PivoColors.navTransfer, width: 1.5),
                  ),
                  child: const Icon(Icons.swap_vert_rounded, color: PivoColors.navTransfer, size: 22),
                ),
              ),
            ),
          ),
          const SizedBox(height: 4),
          const _FieldLabel('To'),
          _AccountTile(
            title: toOwn?.productName ?? 'Select account',
            subtitle: toOwn == null
                ? 'Tap to choose'
                : 'A/C ${toOwn.accountNo} · ${fmtMoney(toOwn.available, toOwn.currency)}',
            accent: PivoColors.navTransfer,
            onTap: savings.length < 2 ? null : () => _pickToOwn(savings),
          ),
        ] else ...[
          const SizedBox(height: 12),
          const _FieldLabel('To member'),
          Container(
            padding: const EdgeInsets.fromLTRB(12, 10, 8, 12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
              boxShadow: [
                BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 8, offset: const Offset(0, 2)),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _toQuery,
                        decoration: const InputDecoration(
                          isDense: true,
                          hintText: 'Account no / name / id',
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          filled: false,
                          contentPadding: EdgeInsets.symmetric(vertical: 8),
                        ),
                        onSubmitted: (_) => _search(),
                      ),
                    ),
                    TextButton(
                      onPressed: _searching ? null : _search,
                      child: _searching
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('Find', style: TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  ],
                ),
                if (_peer != null) ...[
                  const Divider(height: 1),
                  const SizedBox(height: 8),
                  if (_peers.length > 1)
                    DropdownButtonFormField<PeerClient>(
                      value: _peer,
                      decoration: const InputDecoration(
                        labelText: 'Recipient',
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      ),
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
                    )
                  else
                    Text(
                      'Peer · ${_peer!.displayName} · ${_peer!.accountNo}',
                      style: const TextStyle(color: PivoColors.deposit, fontWeight: FontWeight.w700, fontSize: 11.5),
                    ),
                  if (_peerSavings.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: DropdownButtonFormField<int>(
                        value: _toPeerAccountId ?? _peerSavings.first.id,
                        decoration: const InputDecoration(
                          labelText: 'To savings',
                          isDense: true,
                          contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        ),
                        items: _peerSavings
                            .map((s) => DropdownMenuItem(
                                  value: s.id,
                                  child: Text('${s.productName} · ${s.accountNo}', overflow: TextOverflow.ellipsis),
                                ))
                            .toList(),
                        onChanged: (v) => setState(() => _toPeerAccountId = v),
                      ),
                    )
                  else
                    const Text('No active savings on peer', style: TextStyle(fontSize: 11, color: PivoColors.muted)),
                ],
              ],
            ),
          ),
        ],
        const SizedBox(height: 12),
        const _FieldLabel('Amount'),
        Container(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('UGX', style: TextStyle(color: PivoColors.muted, fontWeight: FontWeight.w600, fontSize: 11)),
              TextField(
                controller: _amountCtrl,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, letterSpacing: -0.4),
                decoration: const InputDecoration(
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  filled: false,
                  isDense: true,
                  contentPadding: EdgeInsets.zero,
                ),
                onChanged: (_) => setState(() {}),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: _chips.map((c) {
            final sel = _amount.round() == c;
            return ChoiceChip(
              label: Text(_fmtChip(c)),
              selected: sel,
              onSelected: (_) {
                HapticFeedback.selectionClick();
                setState(() => _amountCtrl.text = '$c');
              },
              selectedColor: PivoColors.accent.withValues(alpha: 0.14),
              labelStyle: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 11.5,
                color: sel ? PivoColors.accent : PivoColors.accent900,
              ),
            );
          }).toList(),
        ),
        const SizedBox(height: 12),
        const _FieldLabel('Note'),
        TextField(
          controller: _noteCtrl,
          decoration: const InputDecoration(hintText: 'Optional note'),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: () => _continue(savings),
          child: const Text('Continue'),
        ),
      ],
    );
  }

  String _fmtChip(int n) => n.toString().replaceAllMapped(
        RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
        (m) => '${m[1]},',
      );
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(text, style: const TextStyle(color: PivoColors.muted, fontWeight: FontWeight.w700, fontSize: 11)),
    );
  }
}

class _ModeToggle extends StatelessWidget {
  const _ModeToggle({required this.mode, required this.onChanged});
  final _TransferMode mode;
  final ValueChanged<_TransferMode> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
      ),
      child: Row(
        children: [
          _seg('Other member', mode == _TransferMode.otherMember, PivoColors.accent, () => onChanged(_TransferMode.otherMember)),
          _seg('Own accounts', mode == _TransferMode.ownAccounts, PivoColors.navTransfer, () => onChanged(_TransferMode.ownAccounts)),
        ],
      ),
    );
  }

  Widget _seg(String label, bool on, Color color, VoidCallback tap) {
    return Expanded(
      child: Material(
        color: on ? color.withValues(alpha: 0.12) : Colors.transparent,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: tap,
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Text(
              label,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 11.5,
                color: on ? color : PivoColors.muted,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AccountTile extends StatelessWidget {
  const _AccountTile({
    required this.title,
    required this.subtitle,
    required this.accent,
    this.onTap,
  });
  final String title;
  final String subtitle;
  final Color accent;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(Icons.savings_outlined, color: accent, size: 20),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: const TextStyle(fontSize: 11, color: PivoColors.muted)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: PivoColors.muted, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

class _ConfirmView extends StatelessWidget {
  const _ConfirmView({
    required this.mode,
    required this.amount,
    required this.note,
    required this.from,
    required this.toOwn,
    required this.peer,
    required this.peerSavings,
    required this.toPeerAccountId,
    required this.busy,
    required this.onBack,
    required this.onConfirm,
  });

  final _TransferMode mode;
  final double amount;
  final String note;
  final SavingsAccount? from;
  final SavingsAccount? toOwn;
  final PeerClient? peer;
  final List<SavingsAccount> peerSavings;
  final int? toPeerAccountId;
  final bool busy;
  final VoidCallback onBack;
  final VoidCallback onConfirm;

  String get _toLine {
    if (mode == _TransferMode.ownAccounts) {
      final t = toOwn;
      return t == null ? '—' : '${t.productName} · ${t.accountNo}';
    }
    final p = peer;
    SavingsAccount? sav;
    for (final s in peerSavings) {
      if (s.id == toPeerAccountId) sav = s;
    }
    if (p == null) return '—';
    if (sav != null) return '${p.displayName} · ${sav.accountNo}';
    return '${p.displayName} · ${p.accountNo}';
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
      children: [
        Row(
          children: [
            IconButton(
              visualDensity: VisualDensity.compact,
              onPressed: busy ? null : onBack,
              icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
            ),
            const Text('Confirm details', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          ],
        ),
        const Text('Check everything before you send.', style: TextStyle(color: PivoColors.muted, fontSize: 12)),
        const SizedBox(height: 14),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
          ),
          child: Column(
            children: [
              const Text('You are sending', style: TextStyle(color: PivoColors.muted, fontSize: 11.5)),
              const SizedBox(height: 6),
              Text(
                fmtMoney(amount),
                style: const TextStyle(
                  color: PivoColors.accent,
                  fontWeight: FontWeight.w800,
                  fontSize: 26,
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(height: 6),
              const Text('Fee · Free', style: TextStyle(color: PivoColors.deposit, fontWeight: FontWeight.w700, fontSize: 11.5)),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
          ),
          child: Column(
            children: [
              _kv('From', from == null ? '—' : '${from!.productName}\nA/C ${from!.accountNo}'),
              const Divider(height: 1, indent: 14),
              _kv('To', _toLine),
              const Divider(height: 1, indent: 14),
              _kv('Note', note.isEmpty ? '—' : note),
              const Divider(height: 1, indent: 14),
              _kv('When', 'Instant · Live Fineract'),
            ],
          ),
        ),
        const SizedBox(height: 18),
        FilledButton(
          onPressed: busy ? null : onConfirm,
          child: busy
              ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Confirm & send'),
        ),
        const SizedBox(height: 8),
        TextButton(onPressed: busy ? null : onBack, child: const Text('Edit details')),
      ],
    );
  }

  Widget _kv(String k, String v) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 64, child: Text(k, style: const TextStyle(color: PivoColors.muted, fontSize: 11.5))),
          Expanded(
            child: Text(v, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5), textAlign: TextAlign.right),
          ),
        ],
      ),
    );
  }
}

class _SuccessView extends StatelessWidget {
  const _SuccessView({
    required this.amount,
    required this.ref,
    required this.note,
    required this.from,
    required this.toOwn,
    required this.peer,
    required this.peerSavings,
    required this.toPeerAccountId,
    required this.mode,
    required this.onDone,
  });

  final double amount;
  final String ref;
  final String note;
  final SavingsAccount? from;
  final SavingsAccount? toOwn;
  final PeerClient? peer;
  final List<SavingsAccount> peerSavings;
  final int? toPeerAccountId;
  final _TransferMode mode;
  final VoidCallback onDone;

  String get _toLine {
    if (mode == _TransferMode.ownAccounts) {
      return toOwn == null ? '—' : '${toOwn!.accountNo} · ${toOwn!.productName}';
    }
    final p = peer;
    SavingsAccount? sav;
    for (final s in peerSavings) {
      if (s.id == toPeerAccountId) sav = s;
    }
    if (p == null) return '—';
    if (sav != null) return '${sav.accountNo} · ${sav.productName}';
    return p.accountNo;
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final when =
        '${now.day} ${_mon(now.month)} ${now.year} · ${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 140),
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
            boxShadow: [
              BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 16, offset: const Offset(0, 6)),
            ],
          ),
          child: Column(
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: const BoxDecoration(color: PivoColors.depositSoft, shape: BoxShape.circle),
                child: const Icon(Icons.check_rounded, color: PivoColors.deposit, size: 34),
              ),
              const SizedBox(height: 12),
              const Text('Transfer successful', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 4),
              Text(
                mode == _TransferMode.ownAccounts
                    ? 'Moved between your accounts'
                    : 'Sent to ${peer?.displayName ?? 'member'}',
                style: const TextStyle(color: PivoColors.muted, fontSize: 12),
              ),
              const SizedBox(height: 10),
              Text(
                fmtMoney(amount),
                style: const TextStyle(
                  color: PivoColors.deposit,
                  fontWeight: FontWeight.w800,
                  fontSize: 26,
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(height: 16),
              const DashedHairline(),
              const SizedBox(height: 10),
              _row('Reference', ref),
              _row('From', from == null ? '—' : '${from!.accountNo} · ${from!.productName}'),
              _row('To', _toLine),
              _row('Date', when),
              _row('Status', 'Posted · Live', valueColor: PivoColors.deposit),
              if (note.isNotEmpty) _row('Note', note),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton(onPressed: onDone, child: const Text('Done')),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _row(String k, String v, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(child: Text(k, style: const TextStyle(color: PivoColors.muted, fontSize: 11))),
          Flexible(
            child: Text(
              v,
              textAlign: TextAlign.right,
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 11, color: valueColor ?? PivoColors.accent900),
            ),
          ),
        ],
      ),
    );
  }

  String _mon(int m) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[m - 1];
  }
}

class DashedHairline extends StatelessWidget {
  const DashedHairline({super.key});
  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, c) {
        const dash = 5.0;
        const gap = 4.0;
        final n = (c.maxWidth / (dash + gap)).floor();
        return Row(
          children: List.generate(
            n,
            (_) => Container(
              width: dash,
              height: 1.2,
              margin: const EdgeInsets.only(right: gap),
              color: const Color(0xFFD5D8DE),
            ),
          ),
        );
      },
    );
  }
}
