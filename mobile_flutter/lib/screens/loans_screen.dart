import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

enum _LoanStep { home, detail, repay, success }

class LoansScreen extends StatefulWidget {
  const LoansScreen({super.key});
  @override
  State<LoansScreen> createState() => _LoansScreenState();
}

class _LoansScreenState extends State<LoansScreen> {
  _LoanStep _step = _LoanStep.home;
  LoanAccount? _loan;
  int? _fromSavingsId;
  final _amountCtrl = TextEditingController();
  final _pinCtrl = TextEditingController();
  bool _busy = false;
  double _lastAmount = 0;
  String _lastRef = '';
  bool _posted = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final sav = context.read<AppState>().bundle?.savings;
      if (sav != null && sav.isNotEmpty) setState(() => _fromSavingsId = sav.first.id);
    });
  }

  @override
  void dispose() {
    _amountCtrl.dispose();
    _pinCtrl.dispose();
    super.dispose();
  }

  double get _amount => double.tryParse(_amountCtrl.text.replaceAll(RegExp(r'[^\d.]'), '')) ?? 0;

  SavingsAccount? _sav(List<SavingsAccount> list) {
    if (_fromSavingsId == null) return list.isEmpty ? null : list.first;
    for (final s in list) {
      if (s.id == _fromSavingsId) return s;
    }
    return list.isEmpty ? null : list.first;
  }

  double _repaidPct(LoanAccount loan) {
    if (loan.principal <= 0) return 0;
    final paid = (loan.principal - loan.outstanding).clamp(0, loan.principal);
    return (paid / loan.principal * 100).clamp(0, 100);
  }

  Map<String, String>? _nextDue(LoanAccount loan) {
    for (final r in loan.scheduleRows) {
      if (r['paid'] != 'Paid') return r;
    }
    return loan.scheduleRows.isEmpty ? null : loan.scheduleRows.last;
  }

  List<Map<String, String>> _paidRows(LoanAccount loan) =>
      loan.scheduleRows.where((r) => r['paid'] == 'Paid').toList().reversed.take(4).toList();

  List<Map<String, String>> _dueRows(LoanAccount loan) =>
      loan.scheduleRows.where((r) => r['paid'] != 'Paid').toList();

  void _openDetail(LoanAccount loan) {
    HapticFeedback.selectionClick();
    setState(() {
      _loan = loan;
      _step = _LoanStep.detail;
    });
  }

  void _openRepay(LoanAccount loan) {
    final next = _nextDue(loan);
    final suggest = double.tryParse(next?['amount'] ?? '') ??
        (loan.outstanding > 0 ? loan.outstanding : 10000);
    // Prefer next instalment amount when sensible
    final nextAmt = double.tryParse(next?['amount'] ?? '') ?? 0;
    setState(() {
      _loan = loan;
      _amountCtrl.text = (nextAmt > 0 && nextAmt <= loan.outstanding ? nextAmt : suggest).round().toString();
      _step = _LoanStep.repay;
    });
  }

  Future<void> _pickFrom(List<SavingsAccount> savings) async {
    final picked = await showModalBottomSheet<int>(
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
              const Text('Pay from', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              for (final s in savings)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: CircleAvatar(
                    backgroundColor: PivoColors.accent.withValues(alpha: 0.12),
                    child: Text(s.productName.isNotEmpty ? s.productName[0] : 'S',
                        style: const TextStyle(color: PivoColors.accent, fontWeight: FontWeight.w800)),
                  ),
                  title: Text(s.productName, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${s.accountNo} · ${fmtMoney(s.available, s.currency)}'),
                  trailing: _fromSavingsId == s.id ? const Icon(Icons.check_circle, color: PivoColors.accent) : null,
                  onTap: () => Navigator.pop(ctx, s.id),
                ),
            ],
          ),
        ),
      ),
    );
    if (picked != null) setState(() => _fromSavingsId = picked);
  }

  Future<bool> _askPin() async {
    _pinCtrl.clear();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.fromLTRB(20, 16, 20, 16 + MediaQuery.of(ctx).viewInsets.bottom),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Confirm with PIN', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 6),
              const Text('Enter your member PIN to post this repayment.',
                  style: TextStyle(color: PivoColors.muted, fontSize: 12)),
              const SizedBox(height: 14),
              TextField(
                controller: _pinCtrl,
                obscureText: true,
                keyboardType: TextInputType.number,
                maxLength: 6,
                autofocus: true,
                decoration: const InputDecoration(labelText: 'PIN', counterText: ''),
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: PivoColors.ochre),
                  onPressed: () {
                    final pin = _pinCtrl.text.trim();
                    if (pin == '1234' || pin == '0000') {
                      Navigator.pop(ctx, true);
                    } else {
                      showToast(ctx, 'Incorrect PIN. Demo PIN is 1234.', error: true);
                    }
                  },
                  child: const Text('Confirm PIN'),
                ),
              ),
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            ],
          ),
        );
      },
    );
    return ok == true;
  }

  Future<void> _confirmRepay() async {
    final loan = _loan;
    if (loan == null) return;
    if (_amount <= 0) {
      showToast(context, 'Enter a valid amount', error: true);
      return;
    }
    final pinOk = await _askPin();
    if (!pinOk || !mounted) return;

    setState(() => _busy = true);
    HapticFeedback.mediumImpact();
    final state = context.read<AppState>();
    final from = _sav(state.bundle?.savings ?? []);
    var posted = false;
    var ref = 'TXN-${DateTime.now().millisecondsSinceEpoch % 100000000}';
    try {
      final note = from == null
          ? 'Pivosacc mobile repayment'
          : 'Pivosacc repay from ${from.accountNo}';
      final res = await state.api.loanRepayment(loanId: loan.id, amount: _amount, note: note);
      await state.refreshBundle();
      posted = true;
      if (res is Map && res['resourceId'] != null) ref = 'TXN-${res['resourceId']}';
      // Refresh loan pointer from bundle
      final updated = state.bundle?.loans.where((l) => l.id == loan.id).toList();
      if (updated != null && updated.isNotEmpty) _loan = updated.first;
    } catch (e) {
      if (mounted) {
        showToast(context, 'Repayment staged: ${e.toString().split('\n').first}', warn: true);
      }
      ref = 'STAGED-${DateTime.now().millisecondsSinceEpoch % 100000000}';
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _lastAmount = _amount;
      _lastRef = ref;
      _posted = posted;
      _step = _LoanStep.success;
    });
  }

  void _done() {
    setState(() {
      _step = _LoanStep.home;
      _loan = null;
      _lastRef = '';
      _posted = false;
    });
  }

  void _showProducts() {
    showToast(context, 'Loan products catalogue coming soon — ask your branch to apply.', warn: true);
  }

  void _showFullSchedule(LoanAccount loan) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.92,
        minChildSize: 0.4,
        builder: (_, scroll) => Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          child: ListView(
            controller: scroll,
            children: [
              Text('${loan.productName} · schedule', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 10),
              if (loan.scheduleRows.isEmpty)
                const Text('No schedule periods available.', style: TextStyle(color: PivoColors.muted))
              else
                for (final r in loan.scheduleRows)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      children: [
                        Expanded(child: Text(r['due'] ?? '—', style: const TextStyle(fontSize: 13))),
                        Text(r['total'] ?? '', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                        const SizedBox(width: 10),
                        Text(
                          r['paid'] ?? '',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: r['paid'] == 'Paid' ? PivoColors.deposit : PivoColors.ochre,
                          ),
                        ),
                      ],
                    ),
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
    final loans = state.bundle?.loans ?? [];
    final savings = state.bundle?.savings ?? [];
    final account = _sav(savings);

    if (_step == _LoanStep.success && _loan != null) {
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
            ),
            child: Column(
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: const BoxDecoration(color: PivoColors.goodSoft, shape: BoxShape.circle),
                  child: const Icon(Icons.check_rounded, color: PivoColors.deposit, size: 34),
                ),
                const SizedBox(height: 12),
                const Text('Repayment successful', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 4),
                Text(_loan!.productName, style: const TextStyle(color: PivoColors.muted, fontSize: 12)),
                const SizedBox(height: 10),
                Text(fmtMoney(_lastAmount),
                    style: const TextStyle(color: PivoColors.deposit, fontWeight: FontWeight.w800, fontSize: 24)),
                const SizedBox(height: 14),
                _kv('Reference', _lastRef),
                _kv('Loan', '${_loan!.accountNo} · ${_loan!.productName}'),
                _kv('From', account?.accountNo ?? '—'),
                _kv('Date', when),
                _kv('Status', _posted ? 'Posted · Live' : 'Staged · retry at branch',
                    valueColor: _posted ? PivoColors.deposit : PivoColors.ochre),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(onPressed: _done, child: const Text('Done')),
                ),
              ],
            ),
          ),
        ],
      );
    }

    if (_step == _LoanStep.repay && _loan != null) {
      final loan = _loan!;
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
        children: [
          Row(
            children: [
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: _busy ? null : () => setState(() => _step = _LoanStep.detail),
                icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
              ),
              const Expanded(
                child: Text('Repay loan', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              ),
            ],
          ),
          const Text('Confirm your repayment', style: TextStyle(color: PivoColors.muted, fontSize: 12)),
          const SizedBox(height: 12),
          const _Lab('Repayment amount'),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('UGX', style: TextStyle(color: PivoColors.muted, fontSize: 11, fontWeight: FontWeight.w700)),
                TextField(
                  controller: _amountCtrl,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(border: InputBorder.none, isDense: true),
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 26, color: PivoColors.accent900),
                  onChanged: (_) => setState(() {}),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: PivoColors.ochreSoft, borderRadius: BorderRadius.circular(14)),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Loan', style: TextStyle(color: PivoColors.ochre, fontWeight: FontWeight.w700, fontSize: 11)),
                      Text(loan.productName, style: const TextStyle(fontWeight: FontWeight.w800)),
                    ],
                  ),
                ),
                Text('#${loan.accountNo}', style: const TextStyle(color: PivoColors.muted, fontWeight: FontWeight.w600, fontSize: 12)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const _Lab('Pay from'),
          Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            child: InkWell(
              onTap: savings.isEmpty ? null : () => _pickFrom(savings),
              borderRadius: BorderRadius.circular(14),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: PivoColors.accent.withValues(alpha: 0.35), width: 1.4),
                ),
                child: Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: PivoColors.accent.withValues(alpha: 0.12),
                      child: Text(
                        account?.productName.isNotEmpty == true ? account!.productName[0] : 'S',
                        style: const TextStyle(color: PivoColors.accent, fontWeight: FontWeight.w800),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(account?.productName ?? 'Select account',
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                          Text(
                            account == null
                                ? 'Tap to choose'
                                : 'Available ${fmtMoney(account.available, account.currency)}',
                            style: const TextStyle(fontSize: 11, color: PivoColors.muted),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.check_circle, color: PivoColors.deposit, size: 20),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
            ),
            child: Column(
              children: [
                _kv('Repayment', fmtMoney(_amount)),
                _kv('Fee', fmtMoney(0)),
                const Divider(height: 16),
                _kv('Total', fmtMoney(_amount), valueColor: PivoColors.accent900, bold: true),
              ],
            ),
          ),
          const SizedBox(height: 18),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: PivoColors.ochre),
            onPressed: _busy ? null : _confirmRepay,
            child: _busy
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('Confirm repayment'),
          ),
          const SizedBox(height: 8),
          const Center(
            child: Text('You will be asked for your PIN next.',
                style: TextStyle(color: PivoColors.muted, fontSize: 11)),
          ),
        ],
      );
    }

    if (_step == _LoanStep.detail && _loan != null) {
      final loan = _loan!;
      // Prefer refreshed loan from bundle
      final live = loans.where((l) => l.id == loan.id).toList();
      final L = live.isNotEmpty ? live.first : loan;
      final pct = _repaidPct(L);
      final next = _nextDue(L);
      final dueLeft = _dueRows(L).length;
      final totalInst = L.scheduleRows.length;
      final paid = _paidRows(L);

      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
        children: [
          Row(
            children: [
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: () => setState(() {
                  _step = _LoanStep.home;
                  _loan = null;
                }),
                icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
              ),
              Expanded(
                child: Text(L.productName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              ),
            ],
          ),
          const _Lab('Loan overview'),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: PivoColors.accent,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(fmtMoney(L.outstanding),
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 26)),
                const SizedBox(height: 4),
                Text('Original amount ${fmtMoney(L.principal)}',
                    style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 12)),
                const SizedBox(height: 14),
                ClipRRect(
                  borderRadius: BorderRadius.circular(99),
                  child: LinearProgressIndicator(
                    value: pct / 100,
                    minHeight: 8,
                    backgroundColor: Colors.white.withValues(alpha: 0.2),
                    color: const Color(0xFFF59E0B),
                  ),
                ),
                const SizedBox(height: 8),
                Text('${pct.round()}% repaid',
                    style: TextStyle(color: Colors.white.withValues(alpha: 0.9), fontSize: 12, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const Text('Repayment schedule', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(child: Text('Next instalment', style: TextStyle(color: PivoColors.muted, fontSize: 12))),
                    Text(next?['due'] ?? '—',
                        style: const TextStyle(color: PivoColors.ochre, fontWeight: FontWeight.w700, fontSize: 12)),
                  ],
                ),
                const SizedBox(height: 6),
                Text(next?['total'] ?? fmtMoney(0),
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18, color: PivoColors.accent900)),
                const SizedBox(height: 4),
                Text(
                  totalInst == 0 ? L.status : '$dueLeft of $totalInst instalments remaining',
                  style: const TextStyle(color: PivoColors.muted, fontSize: 11),
                ),
              ],
            ),
          ),
          if (paid.isNotEmpty) ...[
            const SizedBox(height: 16),
            const Text('Recent payments', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            const SizedBox(height: 8),
            for (final r in paid)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.black.withValues(alpha: 0.05)),
                ),
                child: Row(
                  children: [
                    const CircleAvatar(
                      radius: 14,
                      backgroundColor: PivoColors.goodSoft,
                      child: Icon(Icons.check_rounded, size: 16, color: PivoColors.deposit),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(r['total'] ?? '', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                          Text(r['due'] ?? '', style: const TextStyle(color: PivoColors.muted, fontSize: 11)),
                        ],
                      ),
                    ),
                    const Text('Paid', style: TextStyle(color: PivoColors.deposit, fontWeight: FontWeight.w700, fontSize: 12)),
                  ],
                ),
              ),
          ],
          const SizedBox(height: 14),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: PivoColors.ochre),
            onPressed: () => _openRepay(L),
            child: const Text('Repay this loan'),
          ),
          const SizedBox(height: 8),
          Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            child: InkWell(
              onTap: () => _showFullSchedule(L),
              borderRadius: BorderRadius.circular(14),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
                ),
                child: const Row(
                  children: [
                    Expanded(child: Text('View full schedule', style: TextStyle(fontWeight: FontWeight.w700, color: PivoColors.accent))),
                    Icon(Icons.chevron_right_rounded, color: PivoColors.accent),
                  ],
                ),
              ),
            ),
          ),
        ],
      );
    }

    // HOME
    final active = loans.where((l) => l.active || l.outstanding > 0).toList();
    final primary = active.isNotEmpty ? active.first : (loans.isNotEmpty ? loans.first : null);
    final others = primary == null ? <LoanAccount>[] : loans.where((l) => l.id != primary.id).toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
      children: [
        const PageHeader('Loans', subtitle: 'Choose a loan that fits your plans.'),
        const SizedBox(height: 8),
        if (primary == null)
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
            ),
            child: const Column(
              children: [
                Icon(Icons.percent_rounded, color: PivoColors.ochre, size: 36),
                SizedBox(height: 10),
                Text('No active loans', style: TextStyle(fontWeight: FontWeight.w800)),
                SizedBox(height: 4),
                Text('Explore products below when you are ready to apply.',
                    textAlign: TextAlign.center, style: TextStyle(color: PivoColors.muted, fontSize: 12)),
              ],
            ),
          )
        else ...[
          _HeroLoanCard(
            loan: primary,
            pct: _repaidPct(primary),
            onTap: () => _openDetail(primary),
          ),
          const SizedBox(height: 10),
          _NextPayCard(next: _nextDue(primary), onTap: () => _openDetail(primary)),
          const SizedBox(height: 16),
          const Text('Your loans', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          const SizedBox(height: 8),
          if (others.isEmpty)
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    backgroundColor: PivoColors.ochreSoft,
                    child: const Icon(Icons.percent_rounded, color: PivoColors.ochre, size: 18),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('No other active loans', style: TextStyle(fontWeight: FontWeight.w700)),
                        Text('Apply when you are ready.', style: TextStyle(color: PivoColors.muted, fontSize: 11)),
                      ],
                    ),
                  ),
                ],
              ),
            )
          else
            for (final l in others)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Material(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  child: InkWell(
                    onTap: () => _openDetail(l),
                    borderRadius: BorderRadius.circular(14),
                    child: Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(l.productName, style: const TextStyle(fontWeight: FontWeight.w700)),
                                Text('${l.accountNo} · ${fmtMoney(l.outstanding)}',
                                    style: const TextStyle(color: PivoColors.muted, fontSize: 11)),
                              ],
                            ),
                          ),
                          const Icon(Icons.chevron_right_rounded, color: PivoColors.muted),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
        ],
        const SizedBox(height: 18),
        const Text('Need more funds?', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
        const SizedBox(height: 4),
        const Text('Explore available products and apply in a few steps.',
            style: TextStyle(color: PivoColors.muted, fontSize: 12)),
        const SizedBox(height: 10),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: PivoColors.ochre),
          onPressed: _showProducts,
          child: const Text('View loan products →'),
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: PivoColors.ochreSoft, borderRadius: BorderRadius.circular(14)),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Transparent terms', style: TextStyle(color: PivoColors.ochre, fontWeight: FontWeight.w800)),
              SizedBox(height: 2),
              Text('See rates, fees and schedules before you apply',
                  style: TextStyle(color: PivoColors.ochre, fontSize: 12)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _kv(String k, String v, {Color? valueColor, bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Expanded(child: Text(k, style: TextStyle(color: PivoColors.muted, fontSize: 11, fontWeight: bold ? FontWeight.w800 : FontWeight.w500))),
          Flexible(
            child: Text(v,
                textAlign: TextAlign.right,
                style: TextStyle(
                  fontWeight: bold ? FontWeight.w800 : FontWeight.w700,
                  fontSize: bold ? 13 : 11,
                  color: valueColor ?? PivoColors.accent900,
                )),
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

class _Lab extends StatelessWidget {
  const _Lab(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text, style: const TextStyle(color: PivoColors.muted, fontWeight: FontWeight.w700, fontSize: 11)),
      );
}

class _HeroLoanCard extends StatelessWidget {
  const _HeroLoanCard({required this.loan, required this.pct, required this.onTap});
  final LoanAccount loan;
  final double pct;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: PivoColors.accent,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text('ACTIVE LOAN',
                      style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.75),
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.6)),
                  const Spacer(),
                  Text('${pct.round()}% repaid',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12)),
                ],
              ),
              const SizedBox(height: 8),
              Text(loan.productName, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 17)),
              const SizedBox(height: 10),
              Text('Outstanding balance',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 11)),
              Text(fmtMoney(loan.outstanding),
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 26)),
              const SizedBox(height: 12),
              ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: LinearProgressIndicator(
                  value: pct / 100,
                  minHeight: 8,
                  backgroundColor: Colors.white.withValues(alpha: 0.2),
                  color: const Color(0xFFF59E0B),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NextPayCard extends StatelessWidget {
  const _NextPayCard({required this.next, required this.onTap});
  final Map<String, String>? next;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
          ),
          child: Row(
            children: [
              const Expanded(
                child: Text('Next payment', style: TextStyle(color: PivoColors.muted, fontSize: 12, fontWeight: FontWeight.w600)),
              ),
              Text(next?['total'] ?? '—', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(width: 10),
              Text(next?['due'] ?? '',
                  style: const TextStyle(color: PivoColors.ochre, fontWeight: FontWeight.w700, fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }
}
