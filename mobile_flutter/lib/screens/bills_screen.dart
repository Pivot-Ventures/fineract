import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

class _Biller {
  const _Biller(this.id, this.title, this.subtitle, this.asset, this.accent, this.label);
  final String id, title, subtitle, asset, label;
  final Color accent;
}

const _billers = [
  _Biller('nwsc', 'Water', 'NWSC', 'assets/billers/nwsc.svg', PivoColors.nwsc, 'NWSC Water'),
  _Biller('umeme', 'Electricity', 'UMEME / Yaka', 'assets/billers/umeme.svg', PivoColors.umeme, 'UMEME Electricity'),
  _Biller('dstv', 'Pay TV', 'DStv / GoTV', 'assets/billers/dstv.svg', PivoColors.dstv, 'DStv / GoTV'),
  _Biller('school', 'School fees', 'Institution', 'assets/billers/school.svg', PivoColors.school, 'School fees'),
];

class BillsScreen extends StatefulWidget {
  const BillsScreen({super.key});
  @override
  State<BillsScreen> createState() => _BillsScreenState();
}

class _BillsScreenState extends State<BillsScreen> {
  _Biller _biller = _billers.first;
  int? _fromId;
  final _ref = TextEditingController();
  final _amountCtrl = TextEditingController(text: '25000');
  int _amount = 25000;
  bool _ledger = false;
  bool _busy = false;

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

  String get _refLabel {
    switch (_biller.id) {
      case 'nwsc':
        return 'Meter / NWSC account';
      case 'umeme':
        return 'Yaka / meter number';
      case 'dstv':
        return 'Smartcard / IUC number';
      default:
        return 'Student / institution ID';
    }
  }

  Future<void> _pay() async {
    final amt = double.tryParse(_amountCtrl.text.replaceAll(RegExp(r'[^\d.]'), '')) ?? 0;
    if (amt <= 0) {
      showToast(context, 'Enter a valid amount', error: true);
      return;
    }
    if (_ref.text.trim().isEmpty) {
      showToast(context, 'Enter ${_refLabel.toLowerCase()}', warn: true);
      return;
    }
    final state = context.read<AppState>();
    final sid = _fromId ?? ((state.bundle?.savings.isNotEmpty ?? false) ? state.bundle!.savings.first.id : null);
    setState(() => _busy = true);
    HapticFeedback.mediumImpact();
    try {
      if (_ledger) {
        if (sid == null) throw Exception('No savings account');
        final note = 'Utility:${_biller.label}|ref:${_ref.text.trim()}';
        await state.api.savingsWithdrawal(
          savingsId: sid,
          amount: amt,
          note: note,
          receiptNumber: _ref.text.trim(),
        );
        await state.refreshBundle();
        if (mounted) showToast(context, 'Ledger withdrawal tagged: $note');
      } else {
        if (mounted) {
          showToast(context, 'Phase 1: ${_biller.label} UGX ${amt.round()} — UI success (no MoMo)');
        }
      }
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
        const PageHeader('Pay utilities',
            subtitle: 'Water, electricity, TV and school fees. Optional ledger tag via savings withdrawal.'),
        const SectionTitle('Biller'),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.15,
          children: _billers
              .map((b) => BillerTile(
                    asset: b.asset,
                    title: b.title,
                    subtitle: b.subtitle,
                    accent: b.accent,
                    selected: _biller.id == b.id,
                    onTap: () => setState(() => _biller = b),
                  ))
              .toList(),
        ),
        const SizedBox(height: 12),
        if (savings.isNotEmpty)
          DropdownButtonFormField<int>(
            value: _fromId ?? savings.first.id,
            decoration: const InputDecoration(labelText: 'Pay from'),
            items: savings
                .map((s) => DropdownMenuItem(value: s.id, child: Text(s.label, overflow: TextOverflow.ellipsis)))
                .toList(),
            onChanged: (v) => setState(() => _fromId = v),
          ),
        const SizedBox(height: 12),
        TextField(
          controller: _ref,
          decoration: InputDecoration(labelText: _refLabel, hintText: 'e.g. 123456789'),
        ),
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
          amounts: const [10000, 25000, 50000, 100000],
          selected: _amount,
          onSelect: (a) {
            setState(() {
              _amount = a;
              _amountCtrl.text = '$a';
            });
          },
        ),
        const SizedBox(height: 12),
        SegmentedButton<bool>(
          segments: const [
            ButtonSegment(value: false, label: Text('UI / toast'), icon: Icon(Icons.phone_android, size: 16)),
            ButtonSegment(value: true, label: Text('Ledger withdrawal'), icon: Icon(Icons.account_balance, size: 16)),
          ],
          selected: {_ledger},
          onSelectionChanged: (s) => setState(() => _ledger = s.first),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : _pay,
          child: _busy
              ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Pay bill'),
        ),
        const SizedBox(height: 8),
        const Text(
          'Phase 1: toast only. Ledger withdrawal posts a tagged Fineract savings debit — not a live utility settlement.',
          style: TextStyle(fontSize: 11, color: Colors.black54),
        ),
      ],
    );
  }
}
