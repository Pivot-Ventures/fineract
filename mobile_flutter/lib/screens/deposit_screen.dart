import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

enum _DepStep { form, confirm, success }

class DepositScreen extends StatefulWidget {
  const DepositScreen({super.key});
  @override
  State<DepositScreen> createState() => _DepositScreenState();
}

class _DepositScreenState extends State<DepositScreen> {
  _DepStep _step = _DepStep.form;
  String _rail = 'mtn'; // mtn | airtel | cash
  final _amountCtrl = TextEditingController(text: '50000');
  final _phoneCtrl = TextEditingController();
  int? _savingsId;
  bool _busy = false;
  double _lastAmount = 0;
  String _lastRef = '';

  static const _chips = [10000, 50000, 100000, 250000];

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

  double get _amount => double.tryParse(_amountCtrl.text.replaceAll(RegExp(r'[^\d.]'), '')) ?? 0;

  String get _railLabel {
    switch (_rail) {
      case 'airtel':
        return 'Airtel Money';
      case 'cash':
        return 'Cash / teller';
      default:
        return 'MTN MoMo';
    }
  }

  SavingsAccount? _sav(List<SavingsAccount> list) {
    if (_savingsId == null) return list.isEmpty ? null : list.first;
    for (final s in list) {
      if (s.id == _savingsId) return s;
    }
    return list.isEmpty ? null : list.first;
  }

  bool _validate(List<SavingsAccount> savings) {
    if (_sav(savings) == null) {
      showToast(context, 'No savings account', error: true);
      return false;
    }
    if (_amount <= 0) {
      showToast(context, 'Enter a valid amount', error: true);
      return false;
    }
    if (_rail != 'cash' && _phoneCtrl.text.trim().isEmpty) {
      showToast(context, 'Enter mobile money number', warn: true);
      return false;
    }
    return true;
  }

  void _continue(List<SavingsAccount> savings) {
    if (!_validate(savings)) return;
    HapticFeedback.selectionClick();
    setState(() => _step = _DepStep.confirm);
  }

  Future<void> _confirmPost() async {
    final state = context.read<AppState>();
    final savings = state.bundle?.savings ?? [];
    final account = _sav(savings);
    if (account == null) return;
    setState(() => _busy = true);
    HapticFeedback.mediumImpact();
    try {
      final phone = _phoneCtrl.text.trim();
      final note = _rail == 'cash'
          ? 'Pivosacc cash/teller deposit'
          : 'Pivosacc deposit via $_railLabel $phone';
      final res = await state.api.savingsDeposit(
        savingsId: account.id,
        amount: _amount,
        note: note,
      );
      await state.refreshBundle();
      var ref = 'TXN-${DateTime.now().millisecondsSinceEpoch % 100000000}';
      if (res is Map && res['resourceId'] != null) ref = 'TXN-${res['resourceId']}';
      if (!mounted) return;
      setState(() {
        _lastAmount = _amount;
        _lastRef = ref;
        _busy = false;
        _step = _DepStep.success;
      });
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showToast(context, e.toString(), error: true);
      }
    }
  }

  void _done() {
    setState(() {
      _step = _DepStep.form;
      _amountCtrl.text = '50000';
      _phoneCtrl.clear();
      _lastRef = '';
    });
  }

  Future<void> _pickAccount(List<SavingsAccount> savings) async {
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
              const Text('To account', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 8),
              for (final s in savings)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: CircleAvatar(
                    backgroundColor: PivoColors.deposit.withValues(alpha: 0.12),
                    child: const Icon(Icons.savings_outlined, color: PivoColors.deposit, size: 20),
                  ),
                  title: Text(s.productName, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                  subtitle: Text('${s.accountNo} · ${fmtMoney(s.available, s.currency)}',
                      style: const TextStyle(fontSize: 11.5, color: PivoColors.muted)),
                  trailing: _savingsId == s.id ? const Icon(Icons.check_circle, color: PivoColors.deposit) : null,
                  onTap: () => Navigator.pop(ctx, s.id),
                ),
            ],
          ),
        ),
      ),
    );
    if (picked != null) setState(() => _savingsId = picked);
  }

  @override
  Widget build(BuildContext context) {
    final savings = context.watch<AppState>().bundle?.savings ?? [];
    final account = _sav(savings);

    if (_step == _DepStep.confirm) {
      return Theme(
        data: depositTheme(Theme.of(context)),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
          children: [
            Row(
              children: [
                IconButton(
                  visualDensity: VisualDensity.compact,
                  onPressed: _busy ? null : () => setState(() => _step = _DepStep.form),
                  icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
                ),
                const Text('Review deposit', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              ],
            ),
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
                  const Text('You are depositing', style: TextStyle(color: PivoColors.muted, fontSize: 11.5)),
                  const SizedBox(height: 6),
                  Text(fmtMoney(_amount),
                      style: const TextStyle(color: PivoColors.deposit, fontWeight: FontWeight.w800, fontSize: 26)),
                  const SizedBox(height: 6),
                  Text('via $_railLabel', style: const TextStyle(color: PivoColors.muted, fontSize: 12)),
                ],
              ),
            ),
            const SizedBox(height: 12),
            _InfoCard(rows: [
              ('To', account == null ? '—' : '${account.productName} · ${account.accountNo}'),
              if (_rail != 'cash') ('Phone', _phoneCtrl.text.trim()),
              ('Channel', _railLabel),
              ('When', _rail == 'cash' ? 'Teller / branch credit' : 'Prompt on phone · then post'),
            ]),
            const SizedBox(height: 18),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: PivoColors.deposit),
              onPressed: _busy ? null : _confirmPost,
              child: _busy
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Confirm deposit'),
            ),
            TextButton(
              onPressed: _busy ? null : () => setState(() => _step = _DepStep.form),
              child: const Text('Edit details'),
            ),
          ],
        ),
      );
    }

    if (_step == _DepStep.success) {
      final now = DateTime.now();
      final when =
          '${now.day} ${_mon(now.month)} ${now.year} · ${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
      return Theme(
        data: depositTheme(Theme.of(context)),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 140),
          children: [
            _ReceiptCard(
              title: 'Deposit successful',
              subtitle: _railLabel,
              amountLabel: '+ ${fmtMoney(_lastAmount)}',
              rows: [
                ('Reference', _lastRef),
                ('Account', account == null ? '—' : '${account.accountNo} · ${account.productName}'),
                ('Channel', _railLabel),
                if (_rail != 'cash') ('Phone', _phoneCtrl.text.trim()),
                ('Date', when),
                ('Status', 'Posted · Live'),
              ],
              onDone: _done,
            ),
          ],
        ),
      );
    }

    return Theme(
      data: depositTheme(Theme.of(context)),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
        children: [
          const SoftBanner(
            icon: Icons.south_west_rounded,
            label: 'Fund your savings',
            color: PivoColors.deposit,
            soft: PivoColors.depositSoft,
          ),
          const SizedBox(height: 8),
          const Text('MoMo / Airtel / cash · posts to Fineract live',
              style: TextStyle(color: PivoColors.muted, fontSize: 12)),
          const SizedBox(height: 14),
          const _Label('To account'),
          _TapCard(
            onTap: savings.isEmpty ? null : () => _pickAccount(savings),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: PivoColors.accent.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.savings_outlined, color: PivoColors.accent, size: 20),
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
                            : '${account.accountNo} · ${fmtMoney(account.available, account.currency)}',
                        style: const TextStyle(fontSize: 11, color: PivoColors.muted),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded, color: PivoColors.muted),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const _Label('Channel'),
          Row(
            children: [
              Expanded(child: _ChannelTile(
                label: 'MTN MoMo',
                sub: 'Mobile Money',
                color: PivoColors.momo,
                selected: _rail == 'mtn',
                onTap: () => setState(() => _rail = 'mtn'),
              )),
              const SizedBox(width: 8),
              Expanded(child: _ChannelTile(
                label: 'Airtel',
                sub: 'Mobile Money',
                color: PivoColors.airtel,
                selected: _rail == 'airtel',
                onTap: () => setState(() => _rail = 'airtel'),
              )),
              const SizedBox(width: 8),
              Expanded(child: _ChannelTile(
                label: 'Cash',
                sub: 'Teller',
                color: PivoColors.ochre,
                selected: _rail == 'cash',
                onTap: () => setState(() => _rail = 'cash'),
              )),
            ],
          ),
          if (_rail != 'cash') ...[
            const SizedBox(height: 12),
            const _Label('Phone'),
            TextField(
              controller: _phoneCtrl,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(hintText: '07XX XXX XXX'),
            ),
          ],
          const SizedBox(height: 12),
          const _Label('Amount'),
          Container(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
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
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
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
          AmountChips(
            amounts: _chips,
            selected: _amount.round(),
            accent: PivoColors.deposit,
            onSelect: (a) => setState(() => _amountCtrl.text = '$a'),
          ),
          const SizedBox(height: 18),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: PivoColors.deposit),
            onPressed: () => _continue(savings),
            child: const Text('Continue'),
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

class _Label extends StatelessWidget {
  const _Label(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text, style: const TextStyle(color: PivoColors.muted, fontWeight: FontWeight.w700, fontSize: 11)),
      );
}

class _TapCard extends StatelessWidget {
  const _TapCard({required this.child, this.onTap});
  final Widget child;
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
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
          ),
          child: child,
        ),
      ),
    );
  }
}

class _ChannelTile extends StatelessWidget {
  const _ChannelTile({
    required this.label,
    required this.sub,
    required this.color,
    required this.selected,
    required this.onTap,
  });
  final String label, sub;
  final Color color;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: () {
          HapticFeedback.selectionClick();
          onTap();
        },
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.fromLTRB(10, 12, 10, 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected ? PivoColors.deposit : Colors.black.withValues(alpha: 0.08),
              width: selected ? 1.8 : 1,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
              const SizedBox(height: 8),
              Text(label, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 11.5)),
              Text(sub, style: const TextStyle(fontSize: 10, color: PivoColors.muted)),
            ],
          ),
        ),
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.rows});
  final List<(String, String)> rows;
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
      ),
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0) const Divider(height: 1, indent: 14),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  Expanded(child: Text(rows[i].$1, style: const TextStyle(color: PivoColors.muted, fontSize: 11.5))),
                  Flexible(
                    child: Text(rows[i].$2,
                        textAlign: TextAlign.right,
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ReceiptCard extends StatelessWidget {
  const _ReceiptCard({
    required this.title,
    required this.subtitle,
    required this.amountLabel,
    required this.rows,
    required this.onDone,
  });
  final String title, subtitle, amountLabel;
  final List<(String, String)> rows;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    return Container(
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
            decoration: const BoxDecoration(color: PivoColors.depositSoft, shape: BoxShape.circle),
            child: const Icon(Icons.check_rounded, color: PivoColors.deposit, size: 34),
          ),
          const SizedBox(height: 12),
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 4),
          Text(subtitle, style: const TextStyle(color: PivoColors.muted, fontSize: 12)),
          const SizedBox(height: 10),
          Text(amountLabel,
              style: const TextStyle(color: PivoColors.deposit, fontWeight: FontWeight.w800, fontSize: 24)),
          const SizedBox(height: 14),
          for (final r in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                children: [
                  Expanded(child: Text(r.$1, style: const TextStyle(color: PivoColors.muted, fontSize: 11))),
                  Flexible(
                    child: Text(
                      r.$2,
                      textAlign: TextAlign.right,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 11,
                        color: r.$1 == 'Status' ? PivoColors.deposit : PivoColors.accent900,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: PivoColors.accent),
              onPressed: onDone,
              child: const Text('Done'),
            ),
          ),
        ],
      ),
    );
  }
}
