/// Signed-in member, as returned by the gateway's /v1/me.
class Session {
  Session({
    required this.clientName,
    required this.memberNo,
    this.firstName = '',
    this.office = '',
    this.mobile = '',
    this.device = '',
  });

  final String clientName;
  final String memberNo;
  final String firstName;
  final String office;
  final String mobile;
  final String device;

  String get clientAccountNo => memberNo;
  String get clientOffice => office;

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
    this.limits,
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
  Limits? limits;
  /// Mobile-money deposits are switched on in the gateway (sandbox = simulated approvals).
  bool momoDeposits = false;
  bool momoSandbox = false;
}

/// Recipient confirmed by the gateway before a transfer (name is masked, e.g. "James O.").
class Recipient {
  Recipient({required this.accountNo, required this.name, required this.own});
  final String accountNo;
  final String name;
  final bool own;
}

/// Daily limits the gateway enforces.
class Limits {
  Limits({required this.perTransaction, required this.perDay, required this.usedToday});
  final double perTransaction;
  final double perDay;
  final double usedToday;
  double get leftToday => (perDay - usedToday).clamp(0, perDay);
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
  if (v is String) {
    final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(v);
    if (m != null) return fmtDateArr([int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!)]);
  }
  return v?.toString() ?? '—';
}

/// A mobile-money deposit request; the account is credited only once [status] is "successful".
class MomoDeposit {
  MomoDeposit.fromJson(Map j)
      : id = '${j['id']}',
        status = '${j['status']}',
        reason = j['reason']?.toString(),
        amount = (j['amount'] as num?)?.toDouble() ?? 0,
        network = '${j['network'] ?? ''}',
        phone = '${j['phone'] ?? ''}',
        reference = j['reference']?.toString(),
        providerRef = j['providerRef']?.toString();
  final String id;
  final String status;
  final String? reason;
  final double amount;
  final String network;
  final String phone;
  final String? reference;
  final String? providerRef;
  bool get pending => status == 'pending';
  bool get successful => status == 'successful';
}
