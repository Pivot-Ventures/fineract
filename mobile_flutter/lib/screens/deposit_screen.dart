import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../api/gateway_api.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'channel_screens.dart';

enum _Step { form, confirm, waiting, done }

/// Deposit from MTN MoMo or Airtel Money. The member approves the request on their phone with
/// their mobile-money PIN; the account is credited only when the provider confirms.
/// Falls back to branch instructions when the gateway has mobile money switched off.
class DepositScreen extends StatefulWidget {
  const DepositScreen({super.key});
  @override
  State<DepositScreen> createState() => _DepositScreenState();
}

class _DepositScreenState extends State<DepositScreen> {
  _Step _step = _Step.form;
  String _network = 'mtn';
  int? _savingsId;
  final _phone = TextEditingController();
  final _amount = TextEditingController();
  bool _busy = false;
  MomoDeposit? _deposit;
  Timer? _poll;
  DateTime? _startedAt;

  static const _chips = [10000, 50000, 100000, 250000];
  static const _mtnPrefixes = ['76', '77', '78', '79', '31', '39'];
  static const _airtelPrefixes = ['70', '74', '75', '20'];

  @override
  void dispose() {
    _poll?.cancel();
    _phone.dispose();
    _amount.dispose();
    super.dispose();
  }

  double get _amt => double.tryParse(_amount.text.replaceAll(RegExp(r'\D'), '')) ?? 0;
  String get _label => _network == 'mtn' ? 'MTN MoMo' : 'Airtel Money';

  SavingsAccount? _account(List<SavingsAccount> list) {
    for (final s in list) {
      if (s.id == _savingsId) return s;
    }
    return list.isEmpty ? null : list.first;
  }

  /// National number without leading 0 / 256, or null if not a Ugandan mobile number.
  String? _nsn(String raw) {
    var d = raw.replaceAll(RegExp(r'\D'), '');
    if (d.startsWith('256')) d = d.substring(3);
    if (d.startsWith('0')) d = d.substring(1);
    return RegExp(r'^[2-9]\d{8}$').hasMatch(d) ? d : null;
  }

  void _continue(List<SavingsAccount> savings) {
    final nsn = _nsn(_phone.text);
    if (_account(savings) == null) return showToast(context, 'You have no active savings account', error: true);
    if (nsn == null) return showToast(context, 'Enter your $_label number, e.g. 0772 123456', error: true);
    final prefixes = _network == 'mtn' ? _mtnPrefixes : _airtelPrefixes;
    if (!prefixes.any(nsn.startsWith)) {
      return showToast(context, 'That is not a $_label number', error: true);
    }
    if (_amt < 1000) return showToast(context, 'The minimum deposit is UGX 1,000', error: true);
    if (_amt > 5000000) return showToast(context, 'The maximum deposit is UGX 5,000,000', error: true);
    FocusScope.of(context).unfocus();
    HapticFeedback.selectionClick();
    setState(() => _step = _Step.confirm);
  }

  Future<void> _send(List<SavingsAccount> savings) async {
    final state = context.read<AppState>();
    setState(() => _busy = true);
    try {
      final d = await state.api.requestMomoDeposit(
        savingsId: _account(savings)!.id,
        network: _network,
        phone: _phone.text,
        amount: _amt,
        idempotencyKey: GatewayApi.newIdempotencyKey(),
      );
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      setState(() {
        _deposit = d;
        _startedAt = DateTime.now();
        _step = _Step.waiting;
      });
      _poll = Timer.periodic(const Duration(seconds: 2), (_) => _check());
    } catch (e) {
      if (!state.handleSessionError(e) && mounted) showToast(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _check() async {
    final state = context.read<AppState>();
    final d = _deposit;
    if (d == null) return;
    try {
      final next = await state.api.depositStatus(d.id);
      if (!mounted) return;
      if (!next.pending) {
        _poll?.cancel();
        HapticFeedback.mediumImpact();
        if (next.successful) await state.refreshBundle();
        if (!mounted) return;
        setState(() {
          _deposit = next;
          _step = _Step.done;
        });
      } else if (DateTime.now().difference(_startedAt!) > const Duration(minutes: 3)) {
        // Stop polling; the gateway keeps the request and credits it if the provider confirms later.
        _poll?.cancel();
        setState(() {
          _deposit = next;
          _step = _Step.done;
        });
      }
    } catch (e) {
      if (state.handleSessionError(e)) _poll?.cancel();
    }
  }

  void _reset() {
    _poll?.cancel();
    setState(() {
      _step = _Step.form;
      _deposit = null;
      _amount.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final b = context.watch<AppState>().bundle;
    if (b == null || !b.momoDeposits) return const DepositInfoScreen();
    final savings = b.savings;
    switch (_step) {
      case _Step.form:
        return _form(savings, b.momoSandbox);
      case _Step.confirm:
        return _confirm(savings);
      case _Step.waiting:
        return _waiting();
      case _Step.done:
        return _done();
    }
  }

  Widget _form(List<SavingsAccount> savings, bool sandbox) {
    final acc = _account(savings);
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
      children: [
        const PageHeader('Add money', subtitle: 'Deposit from your mobile money wallet.'),
        if (sandbox) ...[
          const SizedBox(height: 10),
          const SoftBanner(
            icon: Icons.science_outlined,
            label: 'Demo mode — no real mobile money is collected',
            color: PivoColors.ochre,
            soft: Color(0xFFFFF4E0),
          ),
        ],
        const SectionTitle('Pay with'),
        RailTile(
          asset: 'assets/billers/mtn.svg',
          title: 'MTN MoMo',
          subtitle: 'Approve with your MoMo PIN',
          selected: _network == 'mtn',
          selectedBorder: PivoColors.deposit,
          onTap: () => setState(() => _network = 'mtn'),
        ),
        RailTile(
          asset: 'assets/billers/airtel.svg',
          title: 'Airtel Money',
          subtitle: 'Approve with your Airtel Money PIN',
          selected: _network == 'airtel',
          selectedBorder: PivoColors.deposit,
          onTap: () => setState(() => _network = 'airtel'),
        ),
        const SectionTitle('Into account'),
        Card(
          margin: EdgeInsets.zero,
          child: ListTile(
            leading: const Icon(Icons.savings_outlined, color: PivoColors.deposit),
            title: Text(acc?.productName ?? 'No savings account', style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text(acc == null ? '' : 'A/C ${acc.accountNo} · ${fmtMoney(acc.available, acc.currency)}'),
            trailing: savings.length > 1 ? const Icon(Icons.expand_more_rounded) : null,
            onTap: savings.length > 1 ? () => _pickAccount(savings) : null,
          ),
        ),
        const SectionTitle('Mobile money number'),
        TextField(
          controller: _phone,
          keyboardType: TextInputType.phone,
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d +]')), LengthLimitingTextInputFormatter(16)],
          decoration: InputDecoration(hintText: _network == 'mtn' ? 'e.g. 0772 123456' : 'e.g. 0752 123456'),
        ),
        const SectionTitle('Amount (UGX)'),
        TextField(
          controller: _amount,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(7)],
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
          decoration: const InputDecoration(hintText: '0'),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 8),
        AmountChips(
          amounts: _chips,
          selected: _amt.round(),
          accent: PivoColors.deposit,
          onSelect: (v) => setState(() => _amount.text = '$v'),
        ),
        const SizedBox(height: 18),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: PivoColors.deposit, minimumSize: const Size.fromHeight(50)),
          onPressed: () => _continue(savings),
          child: const Text('Continue', style: TextStyle(fontWeight: FontWeight.w700)),
        ),
        const SizedBox(height: 10),
        TextButton(
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => Scaffold(appBar: AppBar(title: const Text('Other ways to deposit')), body: const DepositInfoScreen()),
          )),
          child: const Text('Deposit at a branch instead'),
        ),
      ],
    );
  }

  Future<void> _pickAccount(List<SavingsAccount> savings) async {
    final picked = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: Colors.white,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final s in savings)
              ListTile(
                title: Text(s.productName, style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${s.accountNo} · ${fmtMoney(s.available, s.currency)}'),
                trailing: s.id == _account(savings)?.id ? const Icon(Icons.check_circle, color: PivoColors.deposit) : null,
                onTap: () => Navigator.pop(ctx, s.id),
              ),
          ],
        ),
      ),
    );
    if (picked != null) setState(() => _savingsId = picked);
  }

  Widget _confirm(List<SavingsAccount> savings) {
    final acc = _account(savings)!;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
      children: [
        Row(children: [
          IconButton(
            onPressed: _busy ? null : () => setState(() => _step = _Step.form),
            icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
          ),
          const Text('Confirm deposit', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        ]),
        const SizedBox(height: 8),
        _Card(children: [
          Center(
            child: Text(fmtMoney(_amt),
                style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: PivoColors.deposit)),
          ),
          const SizedBox(height: 14),
          _kv('From', '$_label · ${_phone.text.trim()}'),
          _kv('To', '${acc.productName} · ${acc.accountNo}'),
          _kv('Fee', 'Charged by $_label, if any'),
        ]),
        const SizedBox(height: 12),
        Text(
          'You will get a $_label prompt on ${_phone.text.trim()}. Enter your $_label PIN there to approve. '
          'Never share that PIN — Pivot SACCO will never ask for it.',
          style: const TextStyle(color: PivoColors.muted, fontSize: 12.5, height: 1.4),
        ),
        const SizedBox(height: 18),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: PivoColors.deposit, minimumSize: const Size.fromHeight(50)),
          onPressed: _busy ? null : () => _send(savings),
          child: _busy
              ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Send request', style: TextStyle(fontWeight: FontWeight.w700)),
        ),
      ],
    );
  }

  Widget _waiting() {
    final d = _deposit!;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 40, 16, 140),
      children: [
        const Center(child: SizedBox(width: 56, height: 56, child: CircularProgressIndicator(color: PivoColors.deposit))),
        const SizedBox(height: 24),
        const Center(child: Text('Check your phone', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 20))),
        const SizedBox(height: 8),
        Text(
          'Approve the ${d.network} request for ${fmtMoney(d.amount)} on ${d.phone} with your ${d.network} PIN.',
          textAlign: TextAlign.center,
          style: const TextStyle(color: PivoColors.muted, height: 1.4),
        ),
        const SizedBox(height: 8),
        const Text('Your account is credited as soon as it is approved.',
            textAlign: TextAlign.center, style: TextStyle(color: PivoColors.muted, fontSize: 12)),
      ],
    );
  }

  Widget _done() {
    final d = _deposit!;
    final ok = d.successful;
    final stillPending = d.pending;
    final color = ok ? PivoColors.deposit : (stillPending ? PivoColors.ochre : PivoColors.withdraw);
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 140),
      children: [
        _Card(children: [
          Center(
            child: Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(color: color.withValues(alpha: 0.12), shape: BoxShape.circle),
              child: Icon(ok ? Icons.check_rounded : (stillPending ? Icons.schedule_rounded : Icons.close_rounded),
                  color: color, size: 34),
            ),
          ),
          const SizedBox(height: 12),
          Center(
            child: Text(ok ? 'Deposit successful' : (stillPending ? 'Still waiting for approval' : 'Deposit not completed'),
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          ),
          const SizedBox(height: 6),
          Center(
            child: Text(fmtMoney(d.amount), style: TextStyle(color: color, fontSize: 26, fontWeight: FontWeight.w800)),
          ),
          if (!ok && d.reason != null) ...[
            const SizedBox(height: 8),
            Text(d.reason!, textAlign: TextAlign.center, style: const TextStyle(color: PivoColors.muted)),
          ],
          if (stillPending)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('If you approve it later, your account will be credited automatically.',
                  textAlign: TextAlign.center, style: TextStyle(color: PivoColors.muted)),
            ),
          const SizedBox(height: 14),
          if (d.reference != null) _kv('Reference', d.reference!),
          _kv('${d.network} ref', d.providerRef ?? '—'),
          _kv('From', d.phone),
          _kv('Request', d.id),
        ]),
        const SizedBox(height: 16),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: PivoColors.accent, minimumSize: const Size.fromHeight(50)),
          onPressed: _reset,
          child: Text(ok ? 'Done' : 'Try again', style: const TextStyle(fontWeight: FontWeight.w700)),
        ),
      ],
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: Text(k, style: const TextStyle(color: PivoColors.muted, fontSize: 12.5))),
            Flexible(
              child: Text(v,
                  textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
            ),
          ],
        ),
      );
}

class _Card extends StatelessWidget {
  const _Card({required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
      );
}
