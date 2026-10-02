import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'screens/login_screen.dart';
import 'screens/shell_screen.dart';
import 'state/app_state.dart';
import 'theme.dart';
import 'widgets/common.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ),
  );
  final state = AppState();
  runApp(PivosaccApp(state: state));
  await state.init();
}

class PivosaccApp extends StatelessWidget {
  const PivosaccApp({super.key, required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: state,
      child: MaterialApp(
        title: 'Pivosacc',
        debugShowCheckedModeBanner: false,
        theme: buildPivosaccTheme(),
        // Keep UI dense — ignore oversized system font scale.
        builder: (context, child) {
          final mq = MediaQuery.of(context);
          return MediaQuery(
            data: mq.copyWith(
              textScaler: mq.textScaler.clamp(minScaleFactor: 0.90, maxScaleFactor: 1.0),
            ),
            child: child ?? const SizedBox.shrink(),
          );
        },
        home: Consumer<AppState>(
          builder: (context, s, _) {
            switch (s.phase) {
              case AuthPhase.booting:
                return const Scaffold(body: LoadingPane(label: 'Starting Pivosacc…'));
              case AuthPhase.needsActivation:
                return const ActivationScreen();
              case AuthPhase.locked:
                return const LoginScreen();
              case AuthPhase.unlocked:
                // Any touch postpones the idle auto-lock.
                return Listener(
                  behavior: HitTestBehavior.translucent,
                  onPointerDown: (_) => s.touch(),
                  child: const ShellScreen(),
                );
            }
          },
        ),
      ),
    );
  }
}
