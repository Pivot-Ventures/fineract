import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.onNavigate});
  final void Function(String route) onNavigate;

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

    return RefreshIndicator(
      onRefresh: () => state.refreshBundle(),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
        children: [
          Text('$greet,', style: const TextStyle(color: PivoColors.muted, fontSize: 13.5)),
          Text(b.clientName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20, letterSpacing: -0.3)),
          const SizedBox(height: 16),
          _BalanceCard(bundle: b),
          const SectionTitle('Quick actions'),
          _ActionGrid(onNavigate: onNavigate),
          const SectionTitle('Your accounts'),
          ...b.savings.map((s) => _AccountCard(s)),
          SectionTitle(
            'Recent activity',
            trailing: TextButton(
              onPressed: () => onNavigate('statement'),
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('See all', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
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
                  BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 10, offset: const Offset(0, 3)),
                ],
              ),
              child: Column(
                children: [
                  for (var i = 0; i < b.allTransactions.take(5).length; i++) ...[
                    if (i > 0) const Divider(indent: 68),
                    _TxnRow(b.allTransactions[i]),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.bundle});
  final MemberBundle bundle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: const LinearGradient(
          colors: [Color(0xFF0B1633), Color(0xFF16307A), Color(0xFF21409A)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: PivoColors.accent.withValues(alpha: 0.35),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('Available balance', style: TextStyle(color: Colors.white.withValues(alpha: 0.72), fontSize: 13)),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  bundle.officeName,
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.9), fontSize: 10.5, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            fmtMoney(bundle.totalAvailable, bundle.currency),
            style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.w800, letterSpacing: -0.8),
          ),
          const SizedBox(height: 10),
          Text(
            '${bundle.savings.length} savings · ${bundle.loans.where((l) => l.active).length} active loan${bundle.loans.where((l) => l.active).length == 1 ? '' : 's'}',
            style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 12.5),
          ),
        ],
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
      _Act(Icons.south_west_rounded, 'Deposit', PivoColors.deposit, () => onNavigate('deposit')),
      _Act(Icons.north_east_rounded, 'Withdraw', PivoColors.withdraw, () => onNavigate('withdraw')),
      _Act(Icons.description_outlined, 'Statement', PivoColors.accent, () => onNavigate('statement')),
      _Act(Icons.percent_rounded, 'Loans', PivoColors.navLoans, () => onNavigate('loans')),
    ];
    return Row(
      children: actions
          .map((a) => Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: a,
                ),
              ))
          .toList(),
    );
  }
}

class _Act extends StatelessWidget {
  const _Act(this.icon, this.label, this.color, this.onTap);
  final IconData icon;
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
      borderRadius: BorderRadius.circular(18),
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: color.withValues(alpha: 0.18)),
            ),
            child: Icon(icon, color: color, size: 26),
          ),
          const SizedBox(height: 8),
          Text(label, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: PivoColors.accent900)),
        ],
      ),
    );
  }
}

class _AccountCard extends StatelessWidget {
  const _AccountCard(this.s);
  final SavingsAccount s;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 8, offset: const Offset(0, 2)),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: PivoColors.accent50,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.savings_outlined, color: PivoColors.accent, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(s.productName, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5)),
                const SizedBox(height: 2),
                Text('${s.accountNo} · ${s.status}', style: const TextStyle(fontSize: 12, color: PivoColors.muted)),
              ],
            ),
          ),
          Text(
            fmtMoney(s.available, s.currency),
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 14.5,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class _TxnRow extends StatelessWidget {
  const _TxnRow(this.t);
  final Txn t;

  @override
  Widget build(BuildContext context) {
    final credit = t.isDeposit;
    final color = amountColor(credit);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: credit ? PivoColors.depositSoft : PivoColors.withdrawSoft,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(credit ? Icons.south_west_rounded : Icons.north_east_rounded, size: 18, color: color),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t.typeLabel, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
                const SizedBox(height: 2),
                Text(
                  '${t.dateLabel}${t.accountNo.isNotEmpty ? ' · ${t.accountNo}' : ''}',
                  style: const TextStyle(fontSize: 11.5, color: PivoColors.muted),
                ),
              ],
            ),
          ),
          Text(
            fmtAmt(credit ? t.amount : -t.amount),
            style: TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 14,
              color: color,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}
