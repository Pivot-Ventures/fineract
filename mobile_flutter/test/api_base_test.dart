import 'package:flutter_test/flutter_test.dart';
import 'package:pivosacc/api/fineract_api.dart';

void main() {
  const live = 'https://sacco.pivotventures.tech/fineract-provider/api/v1';

  test('default API base is live HTTPS Fineract', () {
    expect(kDefaultApiBase, live);
    expect(kDefaultApiBase.startsWith('https://'), isTrue);
  });

  test('missing or LAN/demo bases resolve to live', () {
    expect(resolveApiBase(null), live);
    expect(resolveApiBase(''), live);
    expect(
      resolveApiBase('http://192.168.1.123:5174/fineract-provider/api/v1'),
      live,
    );
    expect(resolveApiBase('http://10.0.2.2:5174/fineract-provider/api/v1'), live);
    expect(resolveApiBase('http://127.0.0.1:5174/fineract-provider/api/v1'), live);
    expect(resolveApiBase('http://localhost:5174/fineract-provider/api/v1'), live);
  });

  test('a custom HTTPS base is kept', () {
    const custom = 'https://staging.example.com/fineract-provider/api/v1/';
    expect(
      resolveApiBase(custom),
      'https://staging.example.com/fineract-provider/api/v1',
    );
    expect(isLegacyDemoApiBase(live), isFalse);
  });
}
