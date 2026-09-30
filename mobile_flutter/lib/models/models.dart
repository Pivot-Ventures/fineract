class Session {
  Session({
    required this.username,
    required this.tenantId,
    required this.authKey,
    required this.clientId,
    required this.clientName,
    required this.clientAccountNo,
    this.clientOffice = '',
    this.officeId = 1,
    this.memberRef = '',
  });

  final String username;
  final String tenantId;
  final String authKey;
  final int clientId;
  final String clientName;
  final String clientAccountNo;
  final String clientOffice;
  final int officeId;
  final String memberRef;

  Map<String, dynamic> toJson() => {
        'username': username,
        'tenantId': tenantId,
        'authKey': authKey,
        'clientId': clientId,
        'clientName': clientName,
        'clientAccountNo': clientAccountNo,
        'clientOffice': clientOffice,
        'officeId': officeId,
        'memberRef': memberRef,
      };

  factory Session.fromJson(Map<String, dynamic> j) => Session(
        username: j['username'] as String? ?? 'mifos',
        tenantId: j['tenantId'] as String? ?? 'default',
        authKey: j['authKey'] as String? ?? '',
        clientId: (j['clientId'] as num).toInt(),
        clientName: j['clientName'] as String? ?? '',
        clientAccountNo: j['clientAccountNo'] as String? ?? '',
        clientOffice: j['clientOffice'] as String? ?? '',
        officeId: (j['officeId'] as num?)?.toInt() ?? 1,
        memberRef: j['memberRef'] as String? ?? '',
      );

  String get initials {
    final parts = clientName.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    final a = parts.first[0];
    final b = parts.length > 1 && parts[1].isNotEmpty ? parts[1][0] : '';
    return (a + b).toUpperCase();
  }
}

class SavingsAccount {
  SavingsAccount({
    required this.id,
    required this.accountNo,
    required this.productName,
    required this.balance,
    required this.available,
    required this.currency,
    required this.status,
    required this.active,
    this.transactions = const [],
  });

  final int id;
  final String accountNo;
  final String productName;
  final double balance;
  final double available;
  final String currency;
  final String status;
  final bool active;
  final List<Txn> transactions;

  String get label => '$productName · $accountNo · ${fmtMoney(available, currency)}';
}

class Txn {
  Txn({
    required this.id,
    required this.amount,
    required this.isDeposit,
    required this.dateLabel,
    required this.typeLabel,
    this.accountNo = '',
    this.runningBalance,
  });

  final int id;
  final double amount;
  final bool isDeposit;
  final String dateLabel;
  final String typeLabel;
  final String accountNo;
  final double? runningBalance;
}

class LoanAccount {
  LoanAccount({
    required this.id,
    required this.accountNo,
    required this.productName,
    required this.status,
    required this.principal,
    required this.outstanding,
    this.active = false,
    this.scheduleRows = const [],
  });

  final int id;
  final String accountNo;
  final String productName;
  final String status;
  final double principal;
  final double outstanding;
  final bool active;
  final List<Map<String, String>> scheduleRows;
}

class MemberBundle {
  MemberBundle({
    required this.clientName,
    required this.clientAccountNo,
    required this.officeName,
    required this.currency,
    required this.totalBalance,
    required this.totalAvailable,
    required this.savings,
    required this.loans,
    required this.allTransactions,
  });

  final String clientName;
  final String clientAccountNo;
  final String officeName;
  final String currency;
  final double totalBalance;
  final double totalAvailable;
  final List<SavingsAccount> savings;
  final List<LoanAccount> loans;
  final List<Txn> allTransactions;
}

class PeerClient {
  PeerClient({required this.id, required this.accountNo, required this.displayName, this.officeId = 1});
  final int id;
  final String accountNo;
  final String displayName;
  final int officeId;
}

String fmtMoney(num n, [String currency = 'UGX']) {
  final abs = n.abs().round();
  final s = abs.toString().replaceAllMapped(
    RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
    (m) => '${m[1]},',
  );
  return '$currency ${n < 0 ? '−' : ''}$s';
}

String fmtAmt(num n) {
  final sign = n > 0 ? '+' : (n < 0 ? '−' : '');
  final abs = n.abs().round();
  final s = abs.toString().replaceAllMapped(
    RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
    (m) => '${m[1]},',
  );
  return '$sign$s';
}

String fmtDateArr(dynamic v) {
  if (v is List && v.length >= 3) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    final y = v[0], m = (v[1] as num).toInt(), d = v[2];
    if (m >= 1 && m <= 12) return '$d ${months[m - 1]} $y';
  }
  return v?.toString() ?? '—';
}
