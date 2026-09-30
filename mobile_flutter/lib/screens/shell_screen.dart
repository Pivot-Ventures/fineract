import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';
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

  /// Root tabs: Home | Transfer | Bills | Loans | More  (Deposit = center FAB)
  static const _tabs = ['home', 'transfer', 'bills', 'loans', 'more'];

  void _navigate(String route) {
    HapticFeedback.selectionClick();
    setState(() {
      _route = route;
      if (_tabs.contains(route)) {
        _tab = _tabs.indexOf(route);
      } else if (route == 'withdraw' || route == 'statement' || route == 'profile') {
        _tab = 4; // More
      }
      // deposit keeps current tab highlight under FAB
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

  bool get _isRootTab => _tabs.contains(_route);

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final initials = state.session?.initials ?? '?';
    final showBack = !_isRootTab;
    final depositActive = _route == 'deposit';

    return Scaffold(
      extendBody: true,
      appBar: AppBar(
        leading: showBack
            ? IconButton(
                icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
                onPressed: () => _navigate(_tabs[_tab.clamp(0, _tabs.length - 1)]),
              )
            : null,
        title: GestureDetector(
          onLongPress: _editApiBase,
          child: Row(
            children: [
              Text(_title),
              if (_route == 'home') ...[
                const SizedBox(width: 8),
                const LiveChip(),
              ],
            ],
          ),
        ),
        actions: [
          if (_route == 'home' || _route == 'statement')
            IconButton(
              tooltip: 'Refresh',
              onPressed: () => state.refreshBundle(),
              icon: state.loading
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.refresh_rounded),
            ),
          Padding(
            padding: const EdgeInsets.only(right: 14),
            child: AvatarCircle(initials, onTap: () => _navigate('profile')),
          ),
        ],
      ),
      body: _body(),
      // Option B: center-docked Deposit FAB + notched bottom bar
      floatingActionButton: _DepositFab(
        selected: depositActive,
        onTap: () => _navigate('deposit'),
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      bottomNavigationBar: _CenterNotchDock(
        selectedIndex: depositActive ? -1 : _tab,
        onSelect: (i) {
          HapticFeedback.selectionClick();
          setState(() {
            _tab = i;
            _route = _tabs[i];
          });
        },
      ),
    );
  }
}

/// Option B — full-width white bar with CircularNotchedRectangle for Deposit FAB.
class _CenterNotchDock extends StatelessWidget {
  const _CenterNotchDock({required this.selectedIndex, required this.onSelect});
  final int selectedIndex;
  final ValueChanged<int> onSelect;

  // Home, Transfer | FAB | Bills, Loans, More
  static const _left = [
    _NavSpec('Home', Icons.home_outlined, Icons.home_rounded, PivoColors.navHome, PivoColors.navHomeMuted),
    _NavSpec('Transfer', Icons.swap_horiz_rounded, Icons.swap_horiz_rounded, PivoColors.navTransfer, PivoColors.navTransferMuted),
  ];
  static const _right = [
    _NavSpec('Bills', Icons.receipt_long_outlined, Icons.receipt_long_rounded, PivoColors.navBills, PivoColors.navBillsMuted),
    _NavSpec('Loans', Icons.percent_rounded, Icons.percent_rounded, PivoColors.navLoans, PivoColors.navLoansMuted),
    _NavSpec('More', Icons.grid_view_outlined, Icons.grid_view_rounded, PivoColors.navMore, PivoColors.navMoreMuted),
  ];

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.paddingOf(context).bottom;
    return BottomAppBar(
      color: Colors.white,
      elevation: 12,
      shadowColor: Colors.black26,
      surfaceTintColor: Colors.white,
      padding: EdgeInsets.zero,
      height: 64 + bottom,
      shape: const CircularNotchedRectangle(),
      notchMargin: 8,
      child: Padding(
        padding: EdgeInsets.only(bottom: bottom),
        child: SizedBox(
          height: 64,
          child: Row(
            children: [
              for (var i = 0; i < _left.length; i++)
                Expanded(
                  child: _DockTab(
                    spec: _left[i],
                    selected: selectedIndex == i,
                    onTap: () => onSelect(i),
                  ),
                ),
              const SizedBox(width: 64), // FAB notch gap
              for (var i = 0; i < _right.length; i++)
                Expanded(
                  child: _DockTab(
                    spec: _right[i],
                    selected: selectedIndex == (i + 2),
                    onTap: () => onSelect(i + 2),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavSpec {
  const _NavSpec(this.label, this.outlined, this.filled, this.color, this.muted);
  final String label;
  final IconData outlined;
  final IconData filled;
  final Color color;
  final Color muted;
}

class _DockTab extends StatelessWidget {
  const _DockTab({required this.spec, required this.selected, required this.onTap});
  final _NavSpec spec;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? spec.color : spec.muted;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (selected)
              Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: spec.color.withValues(alpha: 0.14),
                  shape: BoxShape.circle,
                ),
                child: Icon(spec.filled, size: 22, color: color),
              )
            else
              SizedBox(
                width: 36,
                height: 36,
                child: Icon(spec.outlined, size: 22, color: color),
              ),
            const SizedBox(height: 2),
            Text(
              spec.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 10,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DepositFab extends StatelessWidget {
  const _DepositFab({required this.onTap, required this.selected});
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 64,
      height: 64,
      child: FloatingActionButton(
        onPressed: () {
          HapticFeedback.mediumImpact();
          onTap();
        },
        elevation: 6,
        highlightElevation: 8,
        backgroundColor: selected ? PivoColors.good : PivoColors.deposit,
        foregroundColor: Colors.white,
        shape: const CircleBorder(
          side: BorderSide(color: Colors.white, width: 3),
        ),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.add_rounded, size: 26),
            Text(
              'Deposit',
              style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w800, height: 1),
            ),
          ],
        ),
      ),
    );
  }
}
