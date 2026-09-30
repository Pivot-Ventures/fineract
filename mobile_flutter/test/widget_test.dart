import 'package:flutter_test/flutter_test.dart';
import 'package:pivosacc/theme.dart';

void main() {
  test('theme builds', () {
    final t = buildPivosaccTheme();
    expect(t.useMaterial3, isTrue);
  });
}
