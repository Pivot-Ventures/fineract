
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.onNavigate});
  final void Function(String route) onNavigate;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _pageCtrl = PageController(viewportFraction: 0.92);
  int _page = 0;

  @override
  void dispose() {
    _pageCtrl.dispose();
    super.dispose();
  }

  void _openReceipt(BuildContext context, Txn t, MemberBundle b) {
    HapticFeedback.selectionClick();
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ReceiptSheet(txn: t, bundle: b),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final b = state.bundle;
    if (state.loading && b == null) return const LoadingPane(label: 'Loading your accounts…');
    if (b == null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(state.error ?? 'No data', textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton(onPressed: () => state.refreshBundle(), child: const Text('Retry')),
          ],
        ),
      );
    }

    final hour = DateTime.now().hour;
    final greet = hour < 12 ? 'Good morning' : (hour < 17 ? 'Good afternoon' : 'Good evening');
    final savings = b.savings;

    return RefreshIndicator(
      color: PivoColors.accent,
      onRefresh: () => state.refreshBundle(),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(0, 4, 0, 140),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$greet,', style: const TextStyle(color: PivoColors.muted, fontSize: 11.5)),
                Text(
                  b.clientName,
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18, letterSpacing: -0.3),
                ),
                const SizedBox(height: 14),
                // Slim all-accounts total
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('All accounts', style: TextStyle(color: PivoColors.muted, fontSize: 11)),
                          const SizedBox(height: 2),
                          Text(
                            fmtMoney(b.totalAvailable, b.currency),
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 14,
                              fontFeatures: [FontFeature.tabularFigures()],
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: PivoColors.accent.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Text(
                        '${savings.length} savings',
                        style: const TextStyle(
                          color: PivoColors.accent,
                          fontWeight: FontWeight.w700,
                          fontSize: 10,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          // Swipeable per-account balance cards
          if (savings.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 24),
              child: Text('No savings accounts', style: TextStyle(color: PivoColors.muted)),
            )
          else ...[
            SizedBox(
              height: 152,
              child: PageView.builder(
                controller: _pageCtrl,
                itemCount: savings.length,
                onPageChanged: (i) => setState(() => _page = i),
                itemBuilder: (context, i) {
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    child: _AccountBalanceCard(
                      account: savings[i],
                      office: b.officeName,
                      index: i,
                      total: savings.length,
                      onTap: () => widget.onNavigate('statement'),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(savings.length, (i) {
                final on = i == _page;
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: on ? 16 : 7,
                  height: 7,
                  decoration: BoxDecoration(
                    color: on ? PivoColors.accent : const Color(0xFFC5C9D1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                );
              }),
            ),
          ],
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionTitle('Quick actions'),
                _ActionGrid(onNavigate: widget.onNavigate),
                SectionTitle(
                  'Recent activity',
                  trailing: TextButton(
                    onPressed: () => widget.onNavigate('statement'),
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: EdgeInsets.zero,
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: const Text('See all', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 11.5)),
                  ),
                ),
                if (b.allTransactions.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(child: Text('No recent transactions', style: TextStyle(color: PivoColors.muted))),
                  )
                else
                  Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.03),
                          blurRadius: 10,
                          offset: const Offset(0, 3),
                        ),
                      ],
                    ),
                    child: Column(
                      children: [
                        for (var i = 0; i < b.allTransactions.take(5).length; i++) ...[
                          if (i > 0) const Divider(indent: 68, height: 1),
                          _TxnRow(
                            b.allTransactions[i],
                            onTap: () => _openReceipt(context, b.allTransactions[i], b),
                          ),
                        ],
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AccountBalanceCard extends StatelessWidget {
  const _AccountBalanceCard({
    required this.account,
    required this.office,
    required this.index,
    required this.total,
    required this.onTap,
  });

  final SavingsAccount account;
  final String office;
  final int index;
  final int total;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final gradients = [
      const [Color(0xFF0B1633), Color(0xFF16307A), Color(0xFF21409A)],
      const [Color(0xFF083237), Color(0xFF0D6470), Color(0xFF0D9488)],
      const [Color(0xFF2A1A08), Color(0xFF6B4A12), Color(0xFF9E661F)],
    ];
    final g = gradients[index % gradients.length];
    final hint = total <= 1
        ? 'Tap for statement'
        : (index == 0 ? '1 of $total · swipe for next →' : '← ${index + 1} of $total · swipe');

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () {
          HapticFeedback.selectionClick();
          onTap();
        },
        borderRadius: BorderRadius.circular(22),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            gradient: LinearGradient(colors: g, begin: Alignment.topLeft, end: Alignment.bottomRight),
            boxShadow: [
              BoxShadow(
                color: g.last.withValues(alpha: 0.35),
                blurRadius: 18,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        account.active ? 'Active' : account.status,
                        style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w700),
                      ),
                    ),
                    const Spacer(),
                    Container(
                      width: 30,
                      height: 30,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white.withValues(alpha: 0.35), width: 2),
                      ),
                      child: Icon(Icons.savings_outlined, color: Colors.white.withValues(alpha: 0.85), size: 18),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  account.productName,
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.78), fontSize: 11.5),
                ),
                const SizedBox(height: 4),
                Text(
                  fmtMoney(account.available, account.currency),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.5,
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
                const Spacer(),
                Text(
                  'A/C ${account.accountNo} · $office',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.72), fontSize: 11),
                ),
                const SizedBox(height: 4),
                Text(hint, style: TextStyle(color: Colors.white.withValues(alpha: 0.55), fontSize: 10)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ActionGrid extends StatelessWidget {
  const _ActionGrid({required this.onNavigate});
  final void Function(String route) onNavigate;

  @override
  Widget build(BuildContext context) {
    final actions = [
      _Act(Icons.account_balance_wallet_rounded, Icons.add_rounded, 'Deposit', PivoColors.deposit, () => onNavigate('deposit')),
      _Act(Icons.payments_rounded, Icons.north_rounded, 'Withdraw', PivoColors.withdraw, () => onNavigate('withdraw')),
      _Act(Icons.assignment_turned_in_rounded, null, 'Statement', PivoColors.accent, () => onNavigate('statement')),
      _Act(Icons.account_balance_rounded, Icons.percent_rounded, 'Loans', PivoColors.navLoans, () => onNavigate('loans')),
    ];
    return Row(
      children: actions
          .map((a) => Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 4), child: a)))
          .toList(),
    );
  }
}

/// Premium quick-action tile — home only (dock icons untouched).
class _Act extends StatelessWidget {
  const _Act(this.icon, this.badge, this.label, this.color, this.onTap);
  final IconData icon;
  final IconData? badge;
  final String label;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      borderRadius: BorderRadius.circular(20),
      child: Column(
        children: [
          Container(
            width: 58,
            height: 58,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: color.withValues(alpha: 0.18)),
              boxShadow: [
                BoxShadow(color: color.withValues(alpha: 0.12), blurRadius: 10, offset: const Offset(0, 4)),
              ],
            ),
            child: Center(
              child: Container(
                width: 34,
                height: 34,
                decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Icon(icon, color: color, size: badge == null ? 18 : 16),
                    if (badge != null)
                      Positioned(
                        right: 2,
                        top: 2,
                        child: Container(
                          width: 14,
                          height: 14,
                          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                          child: Icon(badge, size: 10, color: Colors.white),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            label,
            style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: PivoColors.accent900),
          ),
        ],
      ),
    );
  }
}

class _TxnRow extends StatelessWidget {
  const _TxnRow(this.t, {required this.onTap});
  final Txn t;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final credit = t.isDeposit;
    final color = amountColor(credit);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: credit ? PivoColors.depositSoft : PivoColors.withdrawSoft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  credit ? Icons.south_west_rounded : Icons.north_east_rounded,
                  size: 18,
                  color: color,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(t.typeLabel, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 11.5)),
                    const SizedBox(height: 2),
                    Text(
                      '${t.dateLabel}${t.accountNo.isNotEmpty ? ' · ${t.accountNo}' : ''}',
                      style: const TextStyle(fontSize: 10.5, color: PivoColors.muted),
                    ),
                  ],
                ),
              ),
              Text(
                fmtAmt(credit ? t.amount : -t.amount),
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 13,
                  color: color,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(width: 4),
              const Icon(Icons.chevron_right_rounded, size: 20, color: Color(0xFFB0B4BC)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReceiptSheet extends StatelessWidget {
  const _ReceiptSheet({required this.txn, required this.bundle});
  final Txn txn;
  final MemberBundle bundle;

  String get _channel {
    final t = txn.typeLabel.toLowerCase();
    if (t.contains('momo') || t.contains('mtn')) return 'MTN Mobile Money';
    if (t.contains('airtel')) return 'Airtel Money';
    if (t.contains('transfer')) return 'Internal transfer';
    if (t.contains('withdraw') || t.contains('cash')) return 'Cash / teller';
    if (t.contains('fee')) return 'System fee';
    return txn.isDeposit ? 'Deposit channel' : 'Payment channel';
  }

  String get _statusLabel => 'Posted';

  String get _title {
    if (txn.isDeposit) return 'Deposit successful';
    final t = txn.typeLabel.toLowerCase();
    if (t.contains('fee')) return 'Fee posted';
    if (t.contains('withdraw')) return 'Withdrawal posted';
    return 'Transaction posted';
  }

  @override
  Widget build(BuildContext context) {
    final credit = txn.isDeposit;
    final color = amountColor(credit);
    final soft = credit ? PivoColors.depositSoft : PivoColors.withdrawSoft;
    final accountLine = txn.accountNo.isNotEmpty
        ? txn.accountNo
        : (bundle.savings.isNotEmpty ? bundle.savings.first.accountNo : bundle.clientAccountNo);
    final product = bundle.savings
        .where((s) => s.accountNo == accountLine)
        .map((s) => s.productName)
        .cast<String?>()
        .firstWhere((_) => true, orElse: () => null);

    return Container(
      margin: const EdgeInsets.only(top: 48),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 10, 24, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 44,
                height: 5,
                decoration: BoxDecoration(color: const Color(0xFFD2D5DB), borderRadius: BorderRadius.circular(3)),
              ),
              const SizedBox(height: 20),
              Container(
                width: 60,
                height: 60,
                decoration: BoxDecoration(color: soft, shape: BoxShape.circle),
                child: Icon(
                  credit ? Icons.check_rounded : Icons.receipt_long_rounded,
                  color: color,
                  size: 30,
                ),
              ),
              const SizedBox(height: 14),
              Text(_title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 4),
              Text(txn.typeLabel, style: const TextStyle(color: PivoColors.muted, fontSize: 12)),
              const SizedBox(height: 12),
              Text(
                '${credit ? '+' : '−'} ${fmtMoney(txn.amount, bundle.currency)}',
                style: TextStyle(
                  color: color,
                  fontWeight: FontWeight.w800,
                  fontSize: 24,
                  letterSpacing: -0.5,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(height: 18),
              const DashedDivider(),
              const SizedBox(height: 14),
              _ReceiptRow('Date & time', txn.dateLabel),
              _ReceiptRow('Transaction ID', 'TXN-${txn.id}'),
              _ReceiptRow('Type', txn.typeLabel),
              _ReceiptRow(
                'Account',
                product != null ? '$accountLine · $product' : accountLine,
              ),
              _ReceiptRow('Channel', _channel),
              _ReceiptRow('Status', _statusLabel, valueColor: PivoColors.deposit),
              if (txn.runningBalance != null)
                _ReceiptRow('Running balance', fmtMoney(txn.runningBalance!, bundle.currency)),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => Navigator.pop(context),
                  style: FilledButton.styleFrom(
                    backgroundColor: PivoColors.accent,
                    minimumSize: const Size.fromHeight(50),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: const Text('Close', style: TextStyle(fontWeight: FontWeight.w700)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReceiptRow extends StatelessWidget {
  const _ReceiptRow(this.label, this.value, {this.valueColor});
  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(label, style: const TextStyle(color: PivoColors.muted, fontSize: 11.5))),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 11.5,
                color: valueColor ?? PivoColors.accent900,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class DashedDivider extends StatelessWidget {
  const DashedDivider({super.key});
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
