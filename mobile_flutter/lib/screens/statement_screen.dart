import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

class StatementScreen extends StatelessWidget {
  const StatementScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final b = state.bundle;
    final txns = b?.allTransactions ?? [];
    return RefreshIndicator(
      onRefresh: () => state.refreshBundle(),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
        children: [
          const PageHeader('E-statement', subtitle: 'Your savings movements.'),
          if (b != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
                boxShadow: [
                  BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 10, offset: const Offset(0, 3)),
                ],
              ),
              child: Row(
                children: [
                  AvatarCircle(state.session?.initials ?? '?', size: 48),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(b.clientName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                        const SizedBox(height: 2),
                        Text(
                          '${b.officeName} · ${b.savings.isNotEmpty ? b.savings.first.accountNo : ''}',
                          style: const TextStyle(fontSize: 12, color: PivoColors.muted),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      const Text('Balance', style: TextStyle(fontSize: 11, color: PivoColors.muted)),
                      Text(
                        fmtMoney(b.totalAvailable, b.currency),
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
          const SectionTitle('Transactions'),
          if (txns.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 40),
              child: Center(child: Text('No transactions yet', style: TextStyle(color: PivoColors.muted))),
            )
          else
            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
              ),
              child: Column(
                children: [
                  for (var i = 0; i < txns.length; i++) ...[
                    if (i > 0) const Divider(indent: 68),
                    _StmtRow(txns[i]),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _StmtRow extends StatelessWidget {
  const _StmtRow(this.t);
  final Txn t;

  @override
  Widget build(BuildContext context) {
    final credit = t.isDeposit;
    final color = amountColor(credit);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
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
                Text(t.typeLabel, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                const SizedBox(height: 2),
                Text(
                  '${t.dateLabel}${t.accountNo.isNotEmpty ? ' · ${t.accountNo}' : ''}',
                  style: const TextStyle(fontSize: 11.5, color: PivoColors.muted),
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                fmtAmt(credit ? t.amount : -t.amount),
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 14.5,
                  color: color,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              if (t.runningBalance != null)
                Text(
                  fmtMoney(t.runningBalance!),
                  style: const TextStyle(fontSize: 10.5, color: PivoColors.muted),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
