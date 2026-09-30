import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/models.dart';

/// Default: LAN proxy on Mac (:5174) so cleartext HTTP matches desk CORS/TLS.
const String kDefaultApiBase =
    'http://192.168.1.123:5174/fineract-provider/api/v1';

class FineractException implements Exception {
  FineractException(this.message, {this.status});
  final String message;
  final int? status;
  @override
  String toString() => message;
}

class FineractApi {
  FineractApi({this.baseUrl = kDefaultApiBase});

  String baseUrl;
  Session? session;

  Map<String, String> _headers({String? authKey, String? tenant}) {
    final s = session;
    final t = tenant ?? s?.tenantId ?? 'default';
    final key = authKey ?? s?.authKey;
    final h = <String, String>{
      'Fineract-Platform-TenantId': t,
      'Accept': 'application/json',
    };
    if (key != null && key.isNotEmpty) {
      h['Authorization'] = 'Basic $key';
    }
    return h;
  }

  Future<dynamic> request(
    String method,
    String path, {
    Object? body,
    String? authKey,
    String? tenant,
  }) async {
    final uri = path.startsWith('http')
        ? Uri.parse(path)
        : Uri.parse('$baseUrl$path');
    final headers = _headers(authKey: authKey, tenant: tenant);
    if (body != null) headers['Content-Type'] = 'application/json';
    late http.Response res;
    try {
      switch (method) {
        case 'GET':
          res = await http.get(uri, headers: headers).timeout(const Duration(seconds: 60));
          break;
        case 'POST':
          res = await http
              .post(uri, headers: headers, body: body == null ? null : jsonEncode(body))
              .timeout(const Duration(seconds: 60));
          break;
        default:
          throw FineractException('Unsupported method $method');
      }
    } catch (e) {
      if (e is FineractException) rethrow;
      throw FineractException('Network error: $e');
    }
    dynamic data;
    if (res.body.isNotEmpty) {
      try {
        data = jsonDecode(res.body);
      } catch (_) {
        data = res.body;
      }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw FineractException(_errMsg(data, res.statusCode), status: res.statusCode);
    }
    return data;
  }

  String _errMsg(dynamic data, int status) {
    if (data is Map) {
      final errors = data['errors'];
      if (errors is List && errors.isNotEmpty) {
        return errors
            .map((e) => (e is Map)
                ? (e['defaultUserMessage'] ?? e['developerMessage'] ?? e['message'] ?? '')
                : '')
            .where((s) => s.toString().isNotEmpty)
            .join('; ');
      }
      if (data['defaultUserMessage'] != null) return data['defaultUserMessage'].toString();
      if (data['message'] != null) return data['message'].toString();
    }
    if (data is String && data.isNotEmpty) return data.length > 200 ? data.substring(0, 200) : data;
    return 'HTTP $status';
  }

  Future<dynamic> get(String path, {String? authKey, String? tenant}) =>
      request('GET', path, authKey: authKey, tenant: tenant);

  Future<dynamic> post(String path, Object? body, {String? authKey, String? tenant}) =>
      request('POST', path, body: body, authKey: authKey, tenant: tenant);

  String todayStr() {
    final d = DateTime.now();
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  Future<Session> memberLogin({
    required String memberRef,
    required String pin,
    String tenantId = 'default',
    String staffUser = 'mifos',
    String staffPass = 'password',
  }) async {
    if (pin.isNotEmpty && pin != '1234' && pin != '0000') {
      throw FineractException('Incorrect PIN. Demo PIN is 1234.');
    }
    final authKey = base64Encode(utf8.encode('$staffUser:$staffPass'));
    Map<String, dynamic> authData;
    try {
      final data = await post(
        '/authentication',
        {'username': staffUser, 'password': staffPass},
        tenant: tenantId,
        authKey: authKey,
      );
      authData = Map<String, dynamic>.from(data as Map);
    } catch (_) {
      await get('/clients?limit=1', tenant: tenantId, authKey: authKey);
      authData = {
        'username': staffUser,
        'base64EncodedAuthenticationKey': authKey,
        'authenticated': true,
      };
    }
    var key = (authData['base64EncodedAuthenticationKey'] ?? authKey).toString();
    key = key.replaceAll(r'\u003d', '=').trim();

    // Temporary session for subsequent calls
    session = Session(
      username: authData['username']?.toString() ?? staffUser,
      tenantId: tenantId,
      authKey: key,
      clientId: 0,
      clientName: '',
      clientAccountNo: '',
      officeId: (authData['officeId'] as num?)?.toInt() ?? 1,
      memberRef: memberRef,
    );

    final clients = await get('/clients?limit=200&offset=0');
    final items = (clients is Map ? clients['pageItems'] as List? : null) ?? [];
    final refLower = memberRef.toLowerCase();
    Map<String, dynamic>? client;
    for (final raw in items) {
      final c = Map<String, dynamic>.from(raw as Map);
      final acc = '${c['accountNo'] ?? ''}';
      final id = '${c['id'] ?? ''}';
      final name = '${c['displayName'] ?? ''}'.toLowerCase();
      final strip = (String s) => s.replaceFirst(RegExp(r'^0+'), '');
      if (id == memberRef ||
          acc == memberRef ||
          strip(acc) == strip(memberRef) ||
          name.contains(refLower)) {
        client = c;
        break;
      }
    }
    client ??= items.isNotEmpty ? Map<String, dynamic>.from(items.first as Map) : null;
    if (client == null) {
      throw FineractException('No members found in Fineract. Create a client first.');
    }

    session = Session(
      username: session!.username,
      tenantId: tenantId,
      authKey: key,
      clientId: (client['id'] as num).toInt(),
      clientName: client['displayName']?.toString() ?? '',
      clientAccountNo: client['accountNo']?.toString() ?? '',
      clientOffice: client['officeName']?.toString() ?? '',
      officeId: (client['officeId'] as num?)?.toInt() ?? session!.officeId,
      memberRef: memberRef,
    );
    return session!;
  }

  Future<MemberBundle> loadMemberBundle() async {
    final s = session;
    if (s == null || s.clientId == 0) throw FineractException('Not logged in');
    final clientId = s.clientId;
    final client = await get('/clients/$clientId') as Map;
    if (client['officeId'] != null) {
      session = Session(
        username: s.username,
        tenantId: s.tenantId,
        authKey: s.authKey,
        clientId: s.clientId,
        clientName: s.clientName,
        clientAccountNo: s.clientAccountNo,
        clientOffice: s.clientOffice,
        officeId: (client['officeId'] as num).toInt(),
        memberRef: s.memberRef,
      );
    }

    Map accounts = {};
    try {
      accounts = await get('/clients/$clientId/accounts') as Map;
    } catch (_) {}
    var savingsList = List<Map>.from((accounts['savingsAccounts'] as List?) ?? []);
    var loanList = List<Map>.from((accounts['loanAccounts'] as List?) ?? []);

    if (savingsList.isEmpty) {
      try {
        final savPage = await get('/savingsaccounts?limit=200');
        final savItems = (savPage is Map ? savPage['pageItems'] as List? : null) ?? [];
        savingsList = savItems
            .where((x) => '${(x as Map)['clientId']}' == '$clientId')
            .map((x) => Map<String, dynamic>.from(x as Map))
            .toList();
      } catch (_) {}
    }

    final savingsDetails = <SavingsAccount>[];
    double totalBalance = 0, totalAvailable = 0;
    var currency = 'UGX';
    final allTxns = <Txn>[];

    for (final item in savingsList) {
      Map detail;
      try {
        detail = await get('/savingsaccounts/${item['id']}?associations=transactions') as Map;
      } catch (_) {
        detail = item;
      }
      final summary = detail['summary'] as Map? ?? {};
      final bal = (summary['accountBalance'] as num?)?.toDouble() ??
          (item['accountBalance'] as num?)?.toDouble() ??
          0;
      final avail = (summary['availableBalance'] as num?)?.toDouble() ??
          (item['availableBalance'] as num?)?.toDouble() ??
          bal;
      final cur = ((detail['currency'] as Map?)?['code'])?.toString() ??
          ((item['currency'] as Map?)?['code'])?.toString() ??
          currency;
      currency = cur;
      final status = ((detail['status'] as Map?)?['value'])?.toString() ??
          ((item['status'] as Map?)?['value'])?.toString() ??
          '—';
      final active = ((detail['status'] as Map?)?['active'] == true) ||
          ((item['status'] as Map?)?['active'] == true) ||
          status == 'Active';
      final rawTxns = List.from((detail['transactions'] as List?) ?? []);
      final txns = rawTxns.map((t) => _mapTxn(t as Map, accountNo: '${detail['accountNo'] ?? item['accountNo'] ?? ''}')).toList();

      savingsDetails.add(SavingsAccount(
        id: (item['id'] as num).toInt(),
        accountNo: '${detail['accountNo'] ?? item['accountNo'] ?? ''}',
        productName:
            '${detail['savingsProductName'] ?? detail['productName'] ?? item['productName'] ?? item['savingsProductName'] ?? 'Savings'}',
        balance: bal,
        available: avail,
        currency: cur,
        status: status,
        active: active,
        transactions: txns,
      ));
      if (active || status == 'Active') {
        totalBalance += bal;
        totalAvailable += avail;
      }
      allTxns.addAll(txns);
    }

    allTxns.sort((a, b) => b.id.compareTo(a.id));

    final loans = <LoanAccount>[];
    for (final la in loanList) {
      try {
        loans.add(_mapLoan(await get('/loans/${la['id']}?associations=all') as Map));
      } catch (_) {
        loans.add(_mapLoan(Map<String, dynamic>.from(la)));
      }
    }
    if (loans.isEmpty) {
      try {
        final page = await get('/loans?limit=200');
        final items = (page is Map ? page['pageItems'] as List? : null) ?? [];
        for (final raw in items) {
          final m = Map<String, dynamic>.from(raw as Map);
          if ('${m['clientId']}' != '$clientId') continue;
          try {
            loans.add(_mapLoan(await get('/loans/${m['id']}?associations=all') as Map));
          } catch (_) {
            loans.add(_mapLoan(m));
          }
        }
      } catch (_) {}
    }

    return MemberBundle(
      clientName: client['displayName']?.toString() ?? s.clientName,
      clientAccountNo: client['accountNo']?.toString() ?? s.clientAccountNo,
      officeName: client['officeName']?.toString() ?? s.clientOffice,
      currency: currency,
      totalBalance: totalBalance,
      totalAvailable: totalAvailable,
      savings: savingsDetails,
      loans: loans,
      allTransactions: allTxns,
    );
  }

  Txn _mapTxn(Map t, {String accountNo = ''}) {
    final type = t['transactionType'] as Map? ?? {};
    final isDep = type['deposit'] == true ||
        type['interestPosting'] == true ||
        RegExp(r'deposit|credit|interest', caseSensitive: false)
            .hasMatch('${type['value'] ?? ''}');
    final isWd = type['withdrawal'] == true;
    return Txn(
      id: (t['id'] as num?)?.toInt() ?? 0,
      amount: (t['amount'] as num?)?.toDouble() ?? 0,
      isDeposit: isDep && !isWd,
      dateLabel: fmtDateArr(t['date']),
      typeLabel: '${type['value'] ?? 'Txn'}',
      accountNo: accountNo,
      runningBalance: (t['runningBalance'] as num?)?.toDouble(),
    );
  }

  LoanAccount _mapLoan(Map loan) {
    final status = (loan['status'] as Map?)?['value']?.toString() ?? '—';
    final summary = loan['summary'] as Map? ?? {};
    final outstanding = (summary['totalOutstanding'] as num?)?.toDouble() ??
        (loan['principal'] as num?)?.toDouble() ??
        0;
    final principal = (loan['principal'] as num?)?.toDouble() ??
        (summary['principalDisbursed'] as num?)?.toDouble() ??
        outstanding;
    final periods = (loan['repaymentSchedule'] as Map?)?['periods'] as List? ?? [];
    final rows = <Map<String, String>>[];
    for (final p in periods.take(6)) {
      final m = p as Map;
      if (m['period'] == null) continue;
      rows.add({
        'due': fmtDateArr(m['dueDate']),
        'total': fmtMoney((m['totalDueForPeriod'] as num?) ?? 0),
        'paid': m['complete'] == true ? 'Paid' : 'Due',
      });
    }
    return LoanAccount(
      id: (loan['id'] as num).toInt(),
      accountNo: '${loan['accountNo'] ?? '#${loan['id']}'}',
      productName: '${loan['loanProductName'] ?? 'Loan'}',
      status: status,
      principal: principal,
      outstanding: outstanding,
      active: (loan['status'] as Map?)?['active'] == true || status == 'Active',
      scheduleRows: rows,
    );
  }

  Future<List<PeerClient>> searchClients(String query) async {
    query = query.trim();
    if (query.isEmpty) return [];
    final clients = await get('/clients?limit=200&offset=0');
    final items = (clients is Map ? clients['pageItems'] as List? : null) ?? [];
    final q = query.toLowerCase();
    final qDigits = query.replaceFirst(RegExp(r'^0+'), '');
    final selfId = session?.clientId;
    return items
        .map((raw) => Map<String, dynamic>.from(raw as Map))
        .where((c) {
          if (selfId != null && (c['id'] as num).toInt() == selfId) return false;
          final acc = '${c['accountNo'] ?? ''}';
          final name = '${c['displayName'] ?? ''}'.toLowerCase();
          final id = '${c['id'] ?? ''}';
          return id == query ||
              acc == query ||
              acc.replaceFirst(RegExp(r'^0+'), '') == qDigits ||
              name.contains(q);
        })
        .take(12)
        .map((c) => PeerClient(
              id: (c['id'] as num).toInt(),
              accountNo: '${c['accountNo'] ?? ''}',
              displayName: '${c['displayName'] ?? ''}',
              officeId: (c['officeId'] as num?)?.toInt() ?? 1,
            ))
        .toList();
  }

  Future<List<SavingsAccount>> getClientSavings(int clientId) async {
    Map accounts = {};
    try {
      accounts = await get('/clients/$clientId/accounts') as Map;
    } catch (_) {}
    var list = List<Map>.from((accounts['savingsAccounts'] as List?) ?? []);
    if (list.isEmpty) {
      try {
        final savPage = await get('/savingsaccounts?limit=200');
        final savItems = (savPage is Map ? savPage['pageItems'] as List? : null) ?? [];
        list = savItems
            .where((x) => '${(x as Map)['clientId']}' == '$clientId')
            .map((x) => Map<String, dynamic>.from(x as Map))
            .toList();
      } catch (_) {}
    }
    return list
        .where((s) {
          final st = s['status'] as Map?;
          return st == null || st['active'] == true || st['value'] == 'Active';
        })
        .map((s) => SavingsAccount(
              id: (s['id'] as num).toInt(),
              accountNo: '${s['accountNo'] ?? ''}',
              productName: '${s['productName'] ?? s['savingsProductName'] ?? 'Savings'}',
              balance: (s['accountBalance'] as num?)?.toDouble() ?? 0,
              available: (s['availableBalance'] as num?)?.toDouble() ??
                  (s['accountBalance'] as num?)?.toDouble() ??
                  0,
              currency: ((s['currency'] as Map?)?['code'])?.toString() ?? 'UGX',
              status: ((s['status'] as Map?)?['value'])?.toString() ?? 'Active',
              active: true,
            ))
        .toList();
  }

  Future<dynamic> accountTransfer({
    required int fromAccountId,
    required int toClientId,
    required int toAccountId,
    required double amount,
    int? fromOfficeId,
    int? toOfficeId,
    int? fromClientId,
    String? description,
  }) async {
    final s = session!;
    if (fromAccountId == toAccountId) {
      throw FineractException('From and to accounts must differ.');
    }
    if (!(amount > 0)) throw FineractException('Enter a valid transfer amount.');
    final body = {
      'fromOfficeId': fromOfficeId ?? s.officeId,
      'fromClientId': fromClientId ?? s.clientId,
      'fromAccountType': 2,
      'fromAccountId': fromAccountId,
      'toOfficeId': toOfficeId ?? fromOfficeId ?? s.officeId,
      'toClientId': toClientId,
      'toAccountType': 2,
      'toAccountId': toAccountId,
      'transferDate': todayStr(),
      'transferAmount': amount,
      'transferDescription': description ?? 'Pivosacc mobile transfer',
      'dateFormat': 'yyyy-MM-dd',
      'locale': 'en',
    };
    return post('/accounttransfers', body);
  }

  Future<dynamic> savingsWithdrawal({
    required int savingsId,
    required double amount,
    String? note,
    String? receiptNumber,
    int paymentTypeId = 1,
  }) async {
    if (!(amount > 0)) throw FineractException('Enter a valid amount.');
    final body = <String, dynamic>{
      'transactionDate': todayStr(),
      'transactionAmount': amount,
      'dateFormat': 'yyyy-MM-dd',
      'locale': 'en',
      'paymentTypeId': paymentTypeId,
    };
    if (note != null && note.isNotEmpty) body['note'] = note;
    if (receiptNumber != null && receiptNumber.isNotEmpty) {
      body['receiptNumber'] = receiptNumber;
    }
    return post('/savingsaccounts/$savingsId/transactions?command=withdrawal', body);
  }

  Future<dynamic> savingsDeposit({
    required int savingsId,
    required double amount,
    String? note,
    int paymentTypeId = 1,
  }) async {
    if (!(amount > 0)) throw FineractException('Enter a valid amount.');
    final body = <String, dynamic>{
      'transactionDate': todayStr(),
      'transactionAmount': amount,
      'dateFormat': 'yyyy-MM-dd',
      'locale': 'en',
      'paymentTypeId': paymentTypeId,
    };
    if (note != null && note.isNotEmpty) body['note'] = note;
    return post('/savingsaccounts/$savingsId/transactions?command=deposit', body);
  }

  Future<dynamic> loanRepayment({
    required int loanId,
    required double amount,
    String? note,
    int paymentTypeId = 4,
  }) async {
    if (!(amount > 0)) throw FineractException('Enter a valid repayment amount.');
    final body = <String, dynamic>{
      'transactionDate': todayStr(),
      'transactionAmount': amount,
      'dateFormat': 'yyyy-MM-dd',
      'locale': 'en',
      'paymentTypeId': paymentTypeId,
    };
    if (note != null && note.isNotEmpty) body['note'] = note;
    return post('/loans/$loanId/transactions?command=repayment', body);
  }
}
