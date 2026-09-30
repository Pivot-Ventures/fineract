import 'package:flutter_test/flutter_test.dart';
import 'package:pivosacc/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Pivosacc app builds', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      const PivosaccApp(initialUrl: 'http://127.0.0.1:5174/'),
    );
    expect(find.text('Pivosacc'), findsOneWidget);
  });
}
