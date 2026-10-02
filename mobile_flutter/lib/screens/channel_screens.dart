import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

// Deposits, withdrawals and bill payments need money to cross into or out of the SACCO
// (mobile money, a biller aggregator). Until those integrations exist, these screens tell the
// member how to do it today instead of posting entries the ledger cannot back with real cash.

class DepositInfoScreen extends StatelessWidget {
  const DepositInfoScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final b = context.watch<AppState>().bundle;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
      children: [
        const PageHeader('Add money', subtitle: 'Ways to deposit into your SACCO savings.'),
        const SizedBox(height: 12),
        const _Way(
          icon: Icons.storefront_rounded,
          color: PivoColors.deposit,
          title: 'At any branch',
          body: 'Give the teller your member number or account number below. Your balance updates as soon as '
              'the teller posts it, and you can see it here.',
        ),
        _Way(
          asset: 'assets/billers/mtn.svg',
          title: 'MTN MoMo & Airtel Money',
          body: 'Coming soon. You will be able to deposit straight from your mobile money wallet.',
          soon: true,
        ),
        const SectionTitle('Your account numbers'),
        if (b == null || b.savings.isEmpty)
          const Text('No active savings accounts.', style: TextStyle(color: PivoColors.muted))
        else
          for (final s in b.savings) _AccountNumberTile(account: s),
      ],
    );
  }
}

class WithdrawScreen extends StatelessWidget {
  const WithdrawScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
      children: const [
        PageHeader('Withdraw', subtitle: 'Ways to take money out of your savings.'),
        SizedBox(height: 12),
        _Way(
          icon: Icons.storefront_rounded,
          color: PivoColors.withdraw,
          title: 'At any branch',
          body: 'Bring your national ID. Withdrawals over the teller limit may need a day\'s notice.',
        ),
        _Way(
          asset: 'assets/billers/airtel.svg',
          title: 'To MTN MoMo or Airtel Money',
          body: 'Coming soon. You will be able to send money from your savings to your mobile money wallet.',
          soon: true,
        ),
        _Way(
          icon: Icons.swap_horiz_rounded,
          color: PivoColors.navTransfer,
          title: 'To another member',
          body: 'Available now — use Transfer to send money to any Pivot SACCO member instantly.',
        ),
      ],
    );
  }
}

class _Biller {
  const _Biller(this.title, this.subtitle, {this.asset});
  final String title, subtitle;
  final String? asset;
}

const _billers = [
  _Biller('NWSC', 'Water', asset: 'assets/billers/nwsc.svg'),
  _Biller('UMEME', 'Yaka / electricity', asset: 'assets/billers/umeme.svg'),
  _Biller('MTN', 'Airtime / data', asset: 'assets/billers/mtn.svg'),
  _Biller('Airtel', 'Airtime / data', asset: 'assets/billers/airtel.svg'),
  _Biller('TV', 'DStv / GoTV', asset: 'assets/billers/dstv.svg'),
  _Biller('School', 'Fees', asset: 'assets/billers/school.svg'),
];

class BillsScreen extends StatelessWidget {
  const BillsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
      children: [
        const PageHeader('Pay bills', subtitle: 'Water, power, airtime, TV and school fees.'),
        const SizedBox(height: 12),
        const SoftBanner(
          icon: Icons.schedule_rounded,
          label: 'Bill payments are coming soon',
          color: PivoColors.ochre,
          soft: Color(0xFFFFF4E0),
        ),
        const SizedBox(height: 14),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.6,
          children: [
            for (final b in _billers)
              Opacity(
                opacity: 0.55,
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.black.withValues(alpha: 0.08)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (b.asset != null) SvgPicture.asset(b.asset!, width: 34, height: 34),
                      const Spacer(),
                      Text(b.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                      Text(b.subtitle, style: const TextStyle(fontSize: 11.5, color: PivoColors.muted)),
                    ],
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 14),
        const Text(
          'We are connecting Pivot SACCO to a licensed bill-payment provider. Until then, pay bills with '
          'mobile money or at the biller\'s office.',
          style: TextStyle(color: PivoColors.muted, fontSize: 12, height: 1.4),
        ),
      ],
    );
  }
}

class _Way extends StatelessWidget {
  const _Way({this.icon, this.asset, this.color = PivoColors.accent, required this.title, required this.body, this.soon = false});
  final IconData? icon;
  final String? asset;
  final Color color;
  final String title;
  final String body;
  final bool soon;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.black.withValues(alpha: 0.07)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Opacity(
            opacity: soon ? 0.6 : 1,
            child: asset != null
                ? SvgPicture.asset(asset!, width: 42, height: 42)
                : Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
                    child: Icon(icon, color: color, size: 22),
                  ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5))),
                    if (soon) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(color: const Color(0xFFFFF4E0), borderRadius: BorderRadius.circular(10)),
                        child: const Text('SOON',
                            style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: PivoColors.ochre)),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 4),
                Text(body, style: const TextStyle(fontSize: 12.5, color: PivoColors.muted, height: 1.4)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AccountNumberTile extends StatelessWidget {
  const _AccountNumberTile({required this.account});
  final SavingsAccount account;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        title: Text(account.accountNo,
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, letterSpacing: 0.6)),
        subtitle: Text(account.productName),
        trailing: IconButton(
          tooltip: 'Copy',
          icon: const Icon(Icons.copy_rounded, size: 20),
          onPressed: () {
            Clipboard.setData(ClipboardData(text: account.accountNo));
            showToast(context, 'Account number copied');
          },
        ),
      ),
    );
  }
}
