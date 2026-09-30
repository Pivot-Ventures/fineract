import 'package:flutter/material.dart';
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
    if (state.loading && b == null) return const LoadingPane(label: 'Loading member ledger…');
    if (b == null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(state.error ?? 'No data'),
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
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Text('$greet, ', style: const TextStyle(color: PivoColors.muted, fontSize: 13)),
          Text(b.clientName, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              gradient: const LinearGradient(
                colors: [PivoColors.accent900, Color(0xFF16307A), PivoColors.accent],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Total available', style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 12)),
                const SizedBox(height: 4),
                Text(fmtMoney(b.totalAvailable, b.currency),
                    style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800)),
                const SizedBox(height: 6),
                Text(
                  '${b.savings.length} account${b.savings.length == 1 ? '' : 's'} · ${b.officeName}',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 12),
                ),
              ],
            ),
          ),
          const SectionTitle('Your accounts'),
          ...b.savings.map((s) => Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  title: Text(s.productName, style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text('${s.accountNo} · ${s.status}', style: const TextStyle(fontSize: 12)),
                  trailing: Text(fmtMoney(s.available, s.currency),
                      style: const TextStyle(fontWeight: FontWeight.w700, fontFeatures: [FontFeature.tabularFigures()])),
                ),
              )),
          const SizedBox(height: 4),
          Row(
            children: [
              _Q(Icons.swap_horiz, 'Transfer', () => onNavigate('transfer')),
              _Q(Icons.receipt_long, 'Pay bills', () => onNavigate('bills')),
              _Q(Icons.arrow_upward, 'Withdraw', () => onNavigate('withdraw'), color: PivoColors.withdraw),
              _Q(Icons.description_outlined, 'Statement', () => onNavigate('statement')),
            ].map((w) => Expanded(child: w)).toList(),
          ),
          const SectionTitle('Recent activity'),
          if (b.allTransactions.isEmpty)
            const Text('No recent transactions', style: TextStyle(color: PivoColors.muted))
          else
            ...b.allTransactions.take(6).map((t) => _TxnTile(t)),
          TextButton(
            onPressed: () => onNavigate('statement'),
            child: const Text('Mini-statement →'),
          ),
        ],
      ),
    );
  }
}

class _Q extends StatelessWidget {
  const _Q(this.icon, this.label, this.onTap, {this.color});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;
  @override
  Widget build(BuildContext context) {
    final c = color ?? PivoColors.accent;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.black.withValues(alpha: 0.08)),
          ),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: c.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
                child: Icon(icon, size: 20, color: c),
              ),
              const SizedBox(height: 6),
              Text(label, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ),
    );
  }
}

class _TxnTile extends StatelessWidget {
  const _TxnTile(this.t);
  final Txn t;
  @override
  Widget build(BuildContext context) {
    final in_ = t.isDeposit;
    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      child: ListTile(
        dense: true,
        leading: CircleAvatar(
          backgroundColor: in_ ? PivoColors.goodSoft : PivoColors.accent50,
          child: Icon(in_ ? Icons.south_west : Icons.north_east, size: 18, color: in_ ? PivoColors.good : PivoColors.accent),
        ),
        title: Text(t.typeLabel, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
        subtitle: Text('${t.dateLabel}${t.accountNo.isNotEmpty ? ' · ${t.accountNo}' : ''}',
            style: const TextStyle(fontSize: 11)),
        trailing: Text(
          fmtAmt(in_ ? t.amount : -t.amount),
          style: TextStyle(
            fontWeight: FontWeight.w700,
            color: in_ ? PivoColors.good : PivoColors.accent900,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ),
    );
  }
}
