import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../models/models.dart';

/// Member gateway base URL, fixed at build time:
///   flutter build apk --dart-define=GATEWAY_URL=https://desk.example.co.ug/mobile/api
/// The app never talks to Fineract directly and holds no staff credentials.
const String kGatewayUrl = String.fromEnvironment('GATEWAY_URL', defaultValue: 'http://192.168.1.123:8700');

class ApiException implements Exception {
  ApiException(this.message, {this.code = '', this.status = 0});
  final String message;
  final String code;
  final int status;

  /// The session ended (idle timeout, unlinked device): the app should lock.
  bool get sessionEnded => code == 'session_expired';
  bool get locked => status == 423;

  @override
  String toString() => message;
}

class GatewayApi {
  GatewayApi({this.baseUrl = kGatewayUrl}) {
    if (kReleaseMode && !baseUrl.startsWith('https://')) {
      throw StateError('Release builds must use an https:// GATEWAY_URL');
    }
  }

  final String baseUrl;
  String? token;
  String? deviceKey;

  Future<dynamic> _send(String method, String path, [Object? body]) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{'Accept': 'application/json'};
    if (body != null) headers['Content-Type'] = 'application/json';
    if (token != null) headers['Authorization'] = 'Bearer $token';
    if (deviceKey != null) headers['X-Device-Key'] = deviceKey!;
    late http.Response res;
    try {
      final f = method == 'GET'
          ? http.get(uri, headers: headers)
          : http.post(uri, headers: headers, body: body == null ? null : jsonEncode(body));
      res = await f.timeout(const Duration(seconds: 45));
    } on TimeoutException {
      throw ApiException('The SACCO system is taking too long to respond. Check your connection and try again.',
          code: 'timeout');
    } on SocketException {
      throw ApiException('No connection. Check your internet and try again.', code: 'offline');
    } on http.ClientException {
      throw ApiException('No connection. Check your internet and try again.', code: 'offline');
    }
    dynamic data;
    if (res.body.isNotEmpty) {
      try {
        data = jsonDecode(res.body);
      } catch (_) {}
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return data;
    final map = data is Map ? data : const {};
    throw ApiException(
      (map['message'] ?? 'Something went wrong (HTTP ${res.statusCode}). Try again.').toString(),
      code: (map['code'] ?? '').toString(),
      status: res.statusCode,
    );
  }

  /// One key per confirmed money movement, so a retry after a dropped connection cannot double-post.
  static String newIdempotencyKey() {
    final r = Random.secure();
    return List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }

  static String newDeviceKey() {
    final r = Random.secure();
    return base64Url.encode(List.generate(32, (_) => r.nextInt(256))).replaceAll('=', '');
  }

  // ---------------------------------------------------------------- auth

  Future<Map> activate({
    required String memberNo,
    required String code,
    required String pin,
    required String deviceKey,
    required String deviceName,
  }) async =>
      await _send('POST', '/v1/auth/activate', {
        'memberNo': memberNo,
        'code': code,
        'pin': pin,
        'deviceKey': deviceKey,
        'deviceName': deviceName,
      }) as Map;

  Future<Map> login({required String memberNo, required String pin, required String deviceKey}) async =>
      await _send('POST', '/v1/auth/login', {'memberNo': memberNo, 'pin': pin, 'deviceKey': deviceKey}) as Map;

  Future<void> logout() => _send('POST', '/v1/auth/logout');

  Future<void> changePin(String currentPin, String newPin) =>
      _send('POST', '/v1/auth/pin', {'currentPin': currentPin, 'newPin': newPin});

  Future<void> deregister() => _send('POST', '/v1/auth/deregister');

  // ---------------------------------------------------------------- reads

  Future<(Session, MemberBundle)> me() async {
    final d = await _send('GET', '/v1/me') as Map;
    final m = d['member'] as Map;
    final session = Session(
      clientName: '${m['name'] ?? ''}',
      memberNo: '${m['memberNo'] ?? ''}',
      firstName: '${m['firstName'] ?? ''}',
      office: '${m['office'] ?? ''}',
      mobile: '${m['mobile'] ?? ''}',
      device: '${m['device'] ?? ''}',
    );
    final currency = '${d['currency'] ?? 'UGX'}';
    final txns = ((d['recent'] as List?) ?? []).map((t) => _txn(t as Map)).toList();
    final savings = ((d['savings'] as List?) ?? []).map((s) {
      final acc = _savings(s as Map);
      return SavingsAccount(
        id: acc.id,
        accountNo: acc.accountNo,
        productName: acc.productName,
        balance: acc.balance,
        available: acc.available,
        currency: acc.currency,
        status: acc.status,
        active: acc.active,
        transactions: txns.where((t) => t.accountNo == acc.accountNo).toList(),
      );
    }).toList();
    final loans = ((d['loans'] as List?) ?? []).map((l) => _loan(l as Map)).toList();
    final lim = d['limits'] as Map?;
    final bundle = MemberBundle(
      clientName: session.clientName,
      clientAccountNo: session.memberNo,
      officeName: session.office,
      currency: currency,
      totalBalance: savings.fold(0.0, (a, s) => a + s.balance),
      totalAvailable: savings.fold(0.0, (a, s) => a + s.available),
      savings: savings,
      loans: loans,
      allTransactions: txns,
      limits: lim == null
          ? null
          : Limits(
              perTransaction: (lim['perTransaction'] as num).toDouble(),
              perDay: (lim['perDay'] as num).toDouble(),
              usedToday: (lim['usedToday'] as num).toDouble(),
            ),
    );
    final ch = d['channels'] as Map?;
    bundle.momoDeposits = ch?['momoDeposits'] == true;
    bundle.momoSandbox = ch?['momoSandbox'] == true;
    return (session, bundle);
  }

  Future<List<Txn>> savingsTransactions(int savingsId) async {
    final d = await _send('GET', '/v1/savings/$savingsId/transactions') as Map;
    return ((d['transactions'] as List?) ?? []).map((t) => _txn(t as Map)).toList();
  }

  // ---------------------------------------------------------------- money movement (PIN required)

  Future<Recipient> recipient(String accountNo) async {
    final d = await _send('POST', '/v1/transfers/recipient', {'accountNo': accountNo}) as Map;
    return Recipient(accountNo: '${d['accountNo']}', name: '${d['name']}', own: d['own'] == true);
  }

  Future<Map> transfer({
    required int fromAccountId,
    required String toAccountNo,
    required double amount,
    required String note,
    required String pin,
    required String idempotencyKey,
  }) async =>
      await _send('POST', '/v1/transfers', {
        'fromAccountId': fromAccountId,
        'toAccountNo': toAccountNo,
        'amount': amount,
        'note': note,
        'pin': pin,
        'idempotencyKey': idempotencyKey,
      }) as Map;

  Future<Map> repayLoan({
    required int loanId,
    required int fromAccountId,
    required double amount,
    required String pin,
    required String idempotencyKey,
  }) async =>
      await _send('POST', '/v1/loans/$loanId/repayments', {
        'fromAccountId': fromAccountId,
        'amount': amount,
        'pin': pin,
        'idempotencyKey': idempotencyKey,
      }) as Map;

  // ---------------------------------------------------------------- mobile-money deposits

  Future<MomoDeposit> requestMomoDeposit({
    required int savingsId,
    required String network,
    required String phone,
    required double amount,
    required String idempotencyKey,
  }) async =>
      MomoDeposit.fromJson(await _send('POST', '/v1/deposits/momo', {
        'savingsId': savingsId,
        'network': network,
        'phone': phone,
        'amount': amount,
        'idempotencyKey': idempotencyKey,
      }) as Map);

  Future<MomoDeposit> depositStatus(String id) async =>
      MomoDeposit.fromJson(await _send('GET', '/v1/deposits/$id') as Map);

  // ---------------------------------------------------------------- mapping

  Txn _txn(Map t) => Txn(
        id: (t['id'] as num?)?.toInt() ?? 0,
        amount: (t['amount'] as num?)?.toDouble() ?? 0,
        isDeposit: t['credit'] == true,
        dateLabel: fmtDateArr(t['date']),
        typeLabel: '${t['type'] ?? 'Transaction'}',
        accountNo: '${t['accountNo'] ?? ''}',
        runningBalance: (t['runningBalance'] as num?)?.toDouble(),
      );

  SavingsAccount _savings(Map s) => SavingsAccount(
        id: (s['id'] as num).toInt(),
        accountNo: '${s['accountNo'] ?? ''}',
        productName: '${s['product'] ?? 'Savings'}',
        balance: (s['balance'] as num?)?.toDouble() ?? 0,
        available: (s['available'] as num?)?.toDouble() ?? 0,
        currency: '${s['currency'] ?? 'UGX'}',
        status: '${s['status'] ?? ''}',
        active: s['active'] == true,
      );

  LoanAccount _loan(Map l) => LoanAccount(
        id: (l['id'] as num).toInt(),
        accountNo: '${l['accountNo'] ?? ''}',
        productName: '${l['product'] ?? 'Loan'}',
        status: '${l['status'] ?? ''}',
        principal: (l['principal'] as num?)?.toDouble() ?? 0,
        outstanding: (l['outstanding'] as num?)?.toDouble() ?? 0,
        active: l['active'] == true,
        scheduleRows: ((l['schedule'] as List?) ?? []).map((r) {
          final m = r as Map;
          final paid = m['paid'] == true;
          final amt = paid ? (m['due'] as num? ?? 0) : (m['outstanding'] as num? ?? 0);
          return <String, String>{
            'due': fmtDateArr(m['dueDate']),
            'total': fmtMoney(amt),
            'amount': '$amt',
            'paid': paid ? 'Paid' : 'Due',
          };
        }).toList(),
      );
}
