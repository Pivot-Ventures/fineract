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
  bool _ledger = true;

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
      if (_ledger) {
        await state.api.savingsWithdrawal(
          savingsId: sid,
          amount: amt,
          note: 'Pivosacc withdraw to ${_rail == 'mtn' ? 'MTN MoMo' : 'Airtel Money'} ${_phoneCtrl.text.trim()}',
          receiptNumber: _phoneCtrl.text.trim(),
        );
        await state.refreshBundle();
        if (mounted) showToast(context, 'Withdrawal posted: UGX ${amt.round()}');
      } else {
        if (mounted) showToast(context, 'Phase 1: ${_rail.toUpperCase()} payout UI ready', warn: true);
      }
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
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: PivoColors.withdrawSoft,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: PivoColors.withdraw.withValues(alpha: 0.3)),
            ),
            child: const Row(
              children: [
                Icon(Icons.north_east, color: PivoColors.withdraw),
                SizedBox(width: 8),
                Expanded(
                  child: Text('Withdraw · RED',
                      style: TextStyle(fontWeight: FontWeight.w700, color: PivoColors.withdraw)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const PageHeader('Withdraw to MoMo', subtitle: 'Cash out savings. Live ledger withdrawal or Phase-1 payout UI.'),
          const SectionTitle('Choose rail'),
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
            const SizedBox(height: 8),
            DropdownButtonFormField<int>(
              value: _savingsId ?? savings.first.id,
              decoration: const InputDecoration(labelText: 'From savings'),
              items: savings
                  .map((s) => DropdownMenuItem(value: s.id, child: Text(s.label, overflow: TextOverflow.ellipsis)))
                  .toList(),
              onChanged: (v) => setState(() => _savingsId = v),
            ),
          ],
          const SizedBox(height: 12),
          TextField(
            controller: _amountCtrl,
            decoration: const InputDecoration(labelText: 'Amount (UGX)'),
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onChanged: (v) => setState(() => _amount = int.tryParse(v) ?? 0),
          ),
          const SizedBox(height: 10),
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
          const SizedBox(height: 12),
          TextField(
            controller: _phoneCtrl,
            decoration: const InputDecoration(labelText: 'Phone number', hintText: '+256 7XX XXX XXX'),
            keyboardType: TextInputType.phone,
          ),
          const SizedBox(height: 12),
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: true, label: Text('Ledger withdrawal'), icon: Icon(Icons.account_balance, size: 16)),
              ButtonSegment(value: false, label: Text('MoMo UI'), icon: Icon(Icons.phone_android, size: 16)),
            ],
            selected: {_ledger},
            onSelectionChanged: (s) => setState(() => _ledger = s.first),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _confirm,
            child: _busy
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text(_ledger ? 'Confirm ledger withdrawal' : 'Confirm withdrawal (UI)'),
          ),
        ],
      ),
    );
  }
}
