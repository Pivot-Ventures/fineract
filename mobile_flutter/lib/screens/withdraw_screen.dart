import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

class WithdrawScreen extends StatefulWidget {
  const WithdrawScreen({super.key});
  @override
  State<WithdrawScreen> createState() => _WithdrawScreenState();
}

class _WithdrawScreenState extends State<WithdrawScreen> {
  String _rail = 'mtn';
  int _amount = 20000;
  final _amountCtrl = TextEditingController(text: '20000');
  final _phoneCtrl = TextEditingController();
  int? _savingsId;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final sav = context.read<AppState>().bundle?.savings;
      if (sav != null && sav.isNotEmpty) setState(() => _savingsId = sav.first.id);
    });
  }

  @override
  void dispose() {
    _amountCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final amt = double.tryParse(_amountCtrl.text.replaceAll(RegExp(r'[^\d.]'), '')) ?? 0;
    if (amt <= 0) {
      showToast(context, 'Enter a valid amount', error: true);
      return;
    }
    if (_phoneCtrl.text.trim().isEmpty) {
      showToast(context, 'Enter phone number', warn: true);
      return;
    }
    final state = context.read<AppState>();
    final sid = _savingsId ?? ((state.bundle?.savings.isNotEmpty ?? false) ? state.bundle!.savings.first.id : null);
    if (sid == null) {
      showToast(context, 'No savings account', error: true);
      return;
    }
    setState(() => _busy = true);
    HapticFeedback.mediumImpact();
    try {
      await state.api.savingsWithdrawal(
        savingsId: sid,
        amount: amt,
        note: 'Pivosacc withdraw to ${_rail == 'mtn' ? 'MTN MoMo' : 'Airtel Money'} ${_phoneCtrl.text.trim()}',
        receiptNumber: _phoneCtrl.text.trim(),
      );
      await state.refreshBundle();
      if (mounted) showToast(context, 'Withdrawal posted: UGX ${amt.round()}');
    } catch (e) {
      if (mounted) showToast(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final savings = state.bundle?.savings ?? [];
    return Theme(
      data: withdrawTheme(Theme.of(context)),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
        children: [
          const SoftBanner(
            icon: Icons.north_east_rounded,
            label: 'Withdraw to mobile money',
            color: PivoColors.withdraw,
            soft: PivoColors.withdrawSoft,
          ),
          const SizedBox(height: 16),
          const PageHeader('Cash out', subtitle: 'Send money from savings to your MoMo wallet.'),
          const SectionTitle('Payout method'),
          RailTile(
            asset: 'assets/billers/mtn.svg',
            title: 'MTN MoMo',
            subtitle: 'Uganda · payout',
            selected: _rail == 'mtn',
            selectedBorder: PivoColors.withdraw,
            onTap: () => setState(() => _rail = 'mtn'),
          ),
          RailTile(
            asset: 'assets/billers/airtel.svg',
            title: 'Airtel Money',
            subtitle: 'Uganda · payout',
            selected: _rail == 'airtel',
            selectedBorder: PivoColors.withdraw,
            onTap: () => setState(() => _rail = 'airtel'),
          ),
          if (savings.isNotEmpty) ...[
            const SectionTitle('From account'),
            DropdownButtonFormField<int>(
              value: _savingsId ?? savings.first.id,
              decoration: const InputDecoration(labelText: 'Savings account'),
              items: savings
                  .map((s) => DropdownMenuItem(value: s.id, child: Text(s.label, overflow: TextOverflow.ellipsis)))
                  .toList(),
              onChanged: (v) => setState(() => _savingsId = v),
            ),
          ],
          const SectionTitle('Amount'),
          TextField(
            controller: _amountCtrl,
            decoration: const InputDecoration(labelText: 'Amount (UGX)', prefixText: 'UGX '),
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
            onChanged: (v) => setState(() => _amount = int.tryParse(v) ?? 0),
          ),
          const SizedBox(height: 12),
          AmountChips(
            amounts: const [10000, 20000, 50000, 100000],
            selected: _amount,
            accent: PivoColors.withdraw,
            onSelect: (a) {
              setState(() {
                _amount = a;
                _amountCtrl.text = '$a';
              });
            },
          ),
          const SectionTitle('Phone'),
          TextField(
            controller: _phoneCtrl,
            decoration: const InputDecoration(labelText: 'Mobile money number', hintText: '+256 7XX XXX XXX'),
            keyboardType: TextInputType.phone,
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _busy ? null : _confirm,
            child: _busy
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('Confirm withdrawal'),
          ),
        ],
      ),
    );
  }
}
