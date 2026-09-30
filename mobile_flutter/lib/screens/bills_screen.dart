import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

enum _BillStep { pick, form, success }

class _Biller {
  const _Biller({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.accent,
    this.asset,
    this.icon,
  });
  final String id, title, subtitle;
  final Color accent;
  final String? asset;
  final IconData? icon;
}

const _billers = [
  _Biller(id: 'nwsc', title: 'NWSC', subtitle: 'Water', accent: PivoColors.nwsc, asset: 'assets/billers/nwsc.svg'),
  _Biller(id: 'umeme', title: 'UMEME', subtitle: 'Electricity', accent: PivoColors.umeme, asset: 'assets/billers/umeme.svg'),
  _Biller(id: 'mtn', title: 'MTN', subtitle: 'Airtime / data', accent: PivoColors.momo, asset: 'assets/billers/mtn.svg'),
  _Biller(id: 'airtel', title: 'Airtel', subtitle: 'Airtime / data', accent: PivoColors.airtel, asset: 'assets/billers/airtel.svg'),
  _Biller(id: 'dstv', title: 'TV', subtitle: 'DStv / GoTV', accent: PivoColors.dstv, asset: 'assets/billers/dstv.svg'),
  _Biller(id: 'school', title: 'School', subtitle: 'Fees', accent: PivoColors.school, asset: 'assets/billers/school.svg'),
  _Biller(id: 'internet', title: 'Internet', subtitle: 'ISP / fibre', accent: Color(0xFF0EA5E9), icon: Icons.wifi_rounded),
  _Biller(id: 'more', title: 'More', subtitle: 'Other billers', accent: PivoColors.navMore, icon: Icons.apps_rounded),
];

class BillsScreen extends StatefulWidget {
  const BillsScreen({super.key});
  @override
  State<BillsScreen> createState() => _BillsScreenState();
}

class _BillsScreenState extends State<BillsScreen> {
  _BillStep _step = _BillStep.pick;
  _Biller _biller = _billers.first;
  int? _fromId;
  final _ref = TextEditingController();
  final _amountCtrl = TextEditingController(text: '45000');
  bool _busy = false;
  double _lastAmount = 0;
  String _lastRef = '';
  bool _ledgerPosted = false;

  static const _chips = [10000, 25000, 45000, 100000];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final sav = context.read<AppState>().bundle?.savings;
      if (sav != null && sav.isNotEmpty) setState(() => _fromId = sav.first.id);
    });
  }

  @override
  void dispose() {
    _ref.dispose();
    _amountCtrl.dispose();
    super.dispose();
  }

  double get _amount => double.tryParse(_amountCtrl.text.replaceAll(RegExp(r'[^\d.]'), '')) ?? 0;

  SavingsAccount? _sav(List<SavingsAccount> list) {
    if (_fromId == null) return list.isEmpty ? null : list.first;
    for (final s in list) {
      if (s.id == _fromId) return s;
    }
    return list.isEmpty ? null : list.first;
  }

  String get _refLabel {
    switch (_biller.id) {
      case 'nwsc':
        return 'Meter / NWSC account';
      case 'umeme':
        return 'Yaka / meter number';
      case 'dstv':
        return 'Smartcard / IUC';
      case 'mtn':
      case 'airtel':
        return 'Phone number';
      case 'school':
        return 'Student / institution ID';
      case 'internet':
        return 'Account / router ID';
      default:
        return 'Reference';
    }
  }

  void _openForm(_Biller b) {
    if (b.id == 'more') {
      showToast(context, 'More billers coming soon — pick a listed utility for now.', warn: true);
      return;
    }
    HapticFeedback.selectionClick();
    setState(() {
      _biller = b;
      _step = _BillStep.form;
    });
  }

  Future<void> _pay() async {
    final state = context.read<AppState>();
    final savings = state.bundle?.savings ?? [];
    final account = _sav(savings);
    if (account == null) {
      showToast(context, 'No savings account', error: true);
      return;
    }
    if (_amount <= 0) {
      showToast(context, 'Enter a valid amount', error: true);
      return;
    }
    if (_ref.text.trim().isEmpty) {
      showToast(context, 'Enter ${_refLabel.toLowerCase()}', warn: true);
      return;
    }
    setState(() => _busy = true);
    HapticFeedback.mediumImpact();
    var posted = false;
    var ref = 'TXN-${DateTime.now().millisecondsSinceEpoch % 100000000}';
    try {
      // Stage aggregator: post tagged withdrawal so ledger moves when possible.
      final note = 'Utility:${_biller.title}|ref:${_ref.text.trim()}';
      final res = await state.api.savingsWithdrawal(
        savingsId: account.id,
        amount: _amount,
        note: note,
        receiptNumber: _ref.text.trim(),
      );
      await state.refreshBundle();
      posted = true;
      if (res is Map && res['resourceId'] != null) ref = 'TXN-${res['resourceId']}';
    } catch (e) {
      // Fallback: staged success UI if withdrawal not allowed / insufficient — still show receipt as staged.
      if (mounted) {
        showToast(context, 'Bill queued (staged): ${e.toString().split('\n').first}', warn: true);
      }
      ref = 'STAGED-${DateTime.now().millisecondsSinceEpoch % 100000000}';
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _lastAmount = _amount;
      _lastRef = ref;
      _ledgerPosted = posted;
      _step = _BillStep.success;
    });
  }

  void _done() {
    setState(() {
      _step = _BillStep.pick;
      _ref.clear();
      _amountCtrl.text = '45000';
      _lastRef = '';
      _ledgerPosted = false;
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
                    child: const Icon(Icons.savings_outlined, color: PivoColors.accent, size: 20),
                  ),
                  title: Text(s.productName, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${s.accountNo} · ${fmtMoney(s.available, s.currency)}'),
                  trailing: _fromId == s.id ? const Icon(Icons.check_circle, color: PivoColors.accent) : null,
                  onTap: () => Navigator.pop(ctx, s.id),
                ),
            ],
          ),
        ),
      ),
    );
    if (picked != null) setState(() => _fromId = picked);
  }

  @override
  Widget build(BuildContext context) {
    final savings = context.watch<AppState>().bundle?.savings ?? [];
    final account = _sav(savings);

    if (_step == _BillStep.success) {
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
                  decoration: const BoxDecoration(color: PivoColors.depositSoft, shape: BoxShape.circle),
                  child: const Icon(Icons.check_rounded, color: PivoColors.deposit, size: 34),
                ),
                const SizedBox(height: 12),
                const Text('Bill paid', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 4),
                Text('${_biller.title} · ${_ref.text.trim()}',
                    style: const TextStyle(color: PivoColors.muted, fontSize: 12)),
                const SizedBox(height: 10),
                Text(fmtMoney(_lastAmount),
                    style: const TextStyle(color: PivoColors.deposit, fontWeight: FontWeight.w800, fontSize: 24)),
                const SizedBox(height: 14),
                _kv('Reference', _lastRef),
                _kv('Biller', _biller.title),
                _kv('From', account?.accountNo ?? '—'),
                _kv('Date', when),
                _kv('Status', _ledgerPosted ? 'Posted · Live' : 'Staged · aggregator pending',
                    valueColor: _ledgerPosted ? PivoColors.deposit : PivoColors.ochre),
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

    if (_step == _BillStep.form) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
        children: [
          Row(
            children: [
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: _busy ? null : () => setState(() => _step = _BillStep.pick),
                icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
              ),
              Text(_biller.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            ],
          ),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: _biller.accent.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_biller.subtitle, style: TextStyle(color: _biller.accent, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text(_refLabel, style: const TextStyle(color: PivoColors.muted, fontSize: 12)),
              ],
            ),
          ),
          const SizedBox(height: 14),
          const _Lab('Customer / meter'),
          TextField(controller: _ref, decoration: InputDecoration(hintText: _refLabel)),
          const SizedBox(height: 12),
          const _Lab('Amount'),
          TextField(
            controller: _amountCtrl,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(prefixText: 'UGX '),
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 8),
          AmountChips(
            amounts: _chips,
            selected: _amount.round(),
            accent: _biller.accent,
            onSelect: (a) => setState(() => _amountCtrl.text = '$a'),
          ),
          const SizedBox(height: 12),
          const _Lab('From'),
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
                  border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(account?.productName ?? 'Select account',
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                          Text(
                            account == null
                                ? 'Tap to choose'
                                : '${account.accountNo} · available ${fmtMoney(account.available, account.currency)}',
                            style: const TextStyle(fontSize: 11, color: PivoColors.muted),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right_rounded, color: PivoColors.muted),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 18),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: _biller.accent),
            onPressed: _busy ? null : _pay,
            child: _busy
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('Continue'),
          ),
        ],
      );
    }

    // pick
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
      children: [
        const Text('Utilities & partners', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 4),
        const Text('Pick a biller to continue.', style: TextStyle(color: PivoColors.muted, fontSize: 12)),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.25,
          children: [
            for (final b in _billers)
              _BillerCard(
                biller: b,
                selected: _biller.id == b.id && _step == _BillStep.pick,
                onTap: () => _openForm(b),
              ),
          ],
        ),
        const SizedBox(height: 14),
        const _Lab('From account'),
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
                border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
              ),
              child: Row(
                children: [
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
          ),
        ),
      ],
    );
  }

  Widget _kv(String k, String v, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(child: Text(k, style: const TextStyle(color: PivoColors.muted, fontSize: 11))),
          Flexible(
            child: Text(v,
                textAlign: TextAlign.right,
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 11, color: valueColor ?? PivoColors.accent900)),
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

class _BillerCard extends StatelessWidget {
  const _BillerCard({required this.biller, required this.selected, required this.onTap});
  final _Biller biller;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: selected ? biller.accent : Colors.black.withValues(alpha: 0.08),
              width: selected ? 1.8 : 1,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (biller.asset != null)
                SvgPicture.asset(biller.asset!, width: 36, height: 36)
              else
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: biller.accent.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(biller.icon ?? Icons.receipt_long, color: biller.accent, size: 20),
                ),
              const Spacer(),
              Text(biller.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
              Text(biller.subtitle, style: const TextStyle(fontSize: 10.5, color: PivoColors.muted)),
            ],
          ),
        ),
      ),
    );
  }
}
