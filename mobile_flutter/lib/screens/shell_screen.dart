import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import 'bills_screen.dart';
import 'deposit_screen.dart';
import 'home_screen.dart';
import 'loans_screen.dart';
import 'more_screen.dart';
import 'statement_screen.dart';
import 'transfer_screen.dart';
import 'withdraw_screen.dart';

class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key});
  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  String _route = 'home';
  int _tab = 0;

  static const _tabs = ['home', 'transfer', 'bills', 'more'];

  void _navigate(String route) {
    setState(() {
      _route = route;
      if (_tabs.contains(route)) {
        _tab = _tabs.indexOf(route);
      } else if (route == 'deposit' ||
          route == 'withdraw' ||
          route == 'statement' ||
          route == 'loans' ||
          route == 'profile') {
        _tab = 3;
      }
    });
  }

  Future<void> _editApiBase() async {
    final state = context.read<AppState>();
    final field = TextEditingController(text: state.apiBase);
    final next = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('API base URL'),
        content: TextField(
          controller: field,
          autofocus: true,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(
            hintText: 'http://192.168.1.123:5174/fineract-provider/api/v1',
            helperText: 'Proxy root or full /api/v1 base',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, kDefaultHint), child: const Text('Reset')),
          FilledButton(onPressed: () => Navigator.pop(ctx, field.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    if (next == null || next.isEmpty) return;
    await state.setApiBase(next == kDefaultHint ? 'http://192.168.1.123:5174/fineract-provider/api/v1' : next);
    if (mounted) {
      showToast(context, 'API base updated');
      await state.refreshBundle();
    }
  }

  static const kDefaultHint = '__RESET__';

  Widget _body() {
    switch (_route) {
      case 'transfer':
        return const TransferScreen();
      case 'bills':
        return const BillsScreen();
      case 'more':
        return MoreScreen(onNavigate: _navigate);
      case 'deposit':
        return const DepositScreen();
      case 'withdraw':
        return const WithdrawScreen();
      case 'statement':
        return const StatementScreen();
      case 'loans':
        return const LoansScreen();
      case 'profile':
        return ProfileScreen(onBack: () => _navigate('more'));
      case 'home':
      default:
        return HomeScreen(onNavigate: _navigate);
    }
  }

  String get _title {
    switch (_route) {
      case 'transfer':
        return 'Transfer';
      case 'bills':
        return 'Pay bills';
      case 'deposit':
        return 'Deposit';
      case 'withdraw':
        return 'Withdraw';
      case 'statement':
        return 'Statement';
      case 'loans':
        return 'Loans';
      case 'profile':
        return 'Profile';
      case 'more':
        return 'More';
      default:
        return 'Pivosacc';
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final initials = state.session?.initials ?? '?';
    final showBack = !['home', 'transfer', 'bills', 'more'].contains(_route);

    return Scaffold(
      appBar: AppBar(
        leading: showBack
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () => _navigate(_tab == 3 ? 'more' : _tabs[_tab]),
              )
            : null,
        title: GestureDetector(
          onLongPress: _editApiBase,
          child: Row(
            children: [
              Text(_title),
              const SizedBox(width: 8),
              const LiveChip(),
            ],
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: () => state.refreshBundle(),
            icon: state.loading
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.refresh),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: AvatarCircle(initials, onTap: () => _navigate('profile')),
          ),
        ],
      ),
      body: _body(),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) {
          setState(() {
            _tab = i;
            _route = _tabs[i];
          });
        },
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.swap_horiz), label: 'Transfer'),
          NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Bills'),
          NavigationDestination(icon: Icon(Icons.more_horiz), label: 'More'),
        ],
      ),
    );
  }
}
