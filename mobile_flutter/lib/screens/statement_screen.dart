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
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          const PageHeader('E-statement', subtitle: 'Movements from your Fineract savings accounts.'),
          if (txns.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 40),
              child: Center(child: Text('No transactions yet', style: TextStyle(color: PivoColors.muted))),
            )
          else
            ...txns.map((t) => _row(t)),
        ],
      ),
    );
  }

  Widget _row(Txn t) {
    final in_ = t.isDeposit;
    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: in_ ? PivoColors.goodSoft : PivoColors.accent50,
          child: Icon(in_ ? Icons.south_west : Icons.north_east,
              size: 18, color: in_ ? PivoColors.good : PivoColors.accent),
        ),
        title: Text(t.typeLabel, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
        subtitle: Text('${t.dateLabel}${t.accountNo.isNotEmpty ? ' · ${t.accountNo}' : ''}'),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              fmtAmt(in_ ? t.amount : -t.amount),
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: in_ ? PivoColors.good : PivoColors.accent900,
              ),
            ),
            if (t.runningBalance != null)
              Text(fmtMoney(t.runningBalance!), style: const TextStyle(fontSize: 10, color: PivoColors.muted)),
          ],
        ),
      ),
    );
  }
}
