import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

class LoansScreen extends StatefulWidget {
  const LoansScreen({super.key});
  @override
  State<LoansScreen> createState() => _LoansScreenState();
}

class _LoansScreenState extends State<LoansScreen> {
  LoanAccount? _repayLoan;
  final _amountCtrl = TextEditingController();
  bool _busy = false;
  bool _momo = false;

  @override
  void dispose() {
    _amountCtrl.dispose();
    super.dispose();
  }

  void _openRepay(LoanAccount loan) {
    setState(() {
      _repayLoan = loan;
      _amountCtrl.text = loan.outstanding > 0 ? '${loan.outstanding.round()}' : '10000';
    });
  }

  Future<void> _submitRepay() async {
    final loan = _repayLoan;
    if (loan == null) return;
    final amt = double.tryParse(_amountCtrl.text.replaceAll(RegExp(r'[^\d.]'), '')) ?? 0;
    if (amt <= 0) {
      showToast(context, 'Enter a valid amount', error: true);
      return;
    }
    if (_momo) {
      showToast(context, 'Loan repay via MoMo is Phase 1 — UI ready.', warn: true);
      return;
    }
    setState(() => _busy = true);
    HapticFeedback.mediumImpact();
    final state = context.read<AppState>();
    try {
      await state.api.loanRepayment(loanId: loan.id, amount: amt, note: 'Pivosacc mobile repayment');
      await state.refreshBundle();
      if (mounted) {
        showToast(context, 'Repayment posted: UGX ${amt.round()}');
        setState(() => _repayLoan = null);
      }
    } catch (e) {
      if (mounted) showToast(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final loans = context.watch<AppState>().bundle?.loans ?? [];
    if (_repayLoan != null) return _repayView(_repayLoan!);
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        const PageHeader('Loans', subtitle: 'Your loan accounts from the SACCO ledger.'),
        if (loans.isEmpty)
          const Padding(
            padding: EdgeInsets.only(top: 40),
            child: Center(child: Text('No loans on this member yet.', style: TextStyle(color: PivoColors.muted))),
          )
        else
          ...loans.map(_loanCard),
      ],
    );
  }

  Widget _loanCard(LoanAccount loan) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(loan.productName, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: loan.active ? PivoColors.goodSoft : PivoColors.accent50,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(loan.status,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: loan.active ? PivoColors.good : PivoColors.accent,
                      )),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(loan.accountNo, style: const TextStyle(color: PivoColors.muted, fontSize: 12)),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: _kv('Principal', fmtMoney(loan.principal))),
                Expanded(child: _kv('Outstanding', fmtMoney(loan.outstanding))),
              ],
            ),
            if (loan.scheduleRows.isNotEmpty) ...[
              const SizedBox(height: 10),
              const Text('Schedule', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 12)),
              ...loan.scheduleRows.map((r) => Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Row(
                      children: [
                        Expanded(child: Text(r['due']!, style: const TextStyle(fontSize: 12))),
                        Text(r['total']!, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                        const SizedBox(width: 8),
                        Text(r['paid']!, style: const TextStyle(fontSize: 11, color: PivoColors.muted)),
                      ],
                    ),
                  )),
            ],
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => _openRepay(loan),
              child: const Text('Repay'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _kv(String k, String v) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(k, style: const TextStyle(fontSize: 11, color: PivoColors.muted)),
          Text(v, style: const TextStyle(fontWeight: FontWeight.w700)),
        ],
      );

  Widget _repayView(LoanAccount loan) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        const PageHeader('Loan repayment', subtitle: 'Repay from the ledger (active loans) or stage MoMo for Phase 1.'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                _row('Product', loan.productName),
                _row('Account', loan.accountNo),
                _row('Status', loan.status),
                _row('Outstanding', fmtMoney(loan.outstanding)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _amountCtrl,
          decoration: const InputDecoration(labelText: 'Amount (UGX)'),
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        ),
        const SizedBox(height: 12),
        SegmentedButton<bool>(
          segments: const [
            ButtonSegment(value: false, label: Text('Ledger'), icon: Icon(Icons.account_balance, size: 16)),
            ButtonSegment(value: true, label: Text('MoMo UI'), icon: Icon(Icons.phone_android, size: 16)),
          ],
          selected: {_momo},
          onSelectionChanged: (s) => setState(() => _momo = s.first),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : _submitRepay,
          child: _busy
              ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Submit repayment'),
        ),
        TextButton(onPressed: () => setState(() => _repayLoan = null), child: const Text('Back to loans')),
      ],
    );
  }

  Widget _row(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Expanded(child: Text(k, style: const TextStyle(color: PivoColors.muted))),
            Text(v, style: const TextStyle(fontWeight: FontWeight.w700)),
          ],
        ),
      );
}
