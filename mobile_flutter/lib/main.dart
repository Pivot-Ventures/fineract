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
  await state.init();
  runApp(PivosaccApp(state: state));
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
        home: Consumer<AppState>(
          builder: (context, s, _) {
            if (s.booting) {
              return const Scaffold(body: LoadingPane(label: 'Starting Pivosacc…'));
            }
            if (!s.isLoggedIn) return const LoginScreen();
            return const ShellScreen();
          },
        ),
      ),
    );
  }
}
