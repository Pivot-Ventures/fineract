import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../api/gateway_api.dart';
import '../models/models.dart';

const _kDeviceKey = 'pivosacc_device_key';
const _kMemberNo = 'pivosacc_member_no';
const _kFirstName = 'pivosacc_first_name';

/// Where the app is in its sign-in lifecycle.
enum AuthPhase { booting, needsActivation, locked, unlocked }

/// App state. The session token lives in memory only: closing the app, going idle or leaving it in
/// the background locks it, and the member enters their PIN again — like any banking app.
class AppState extends ChangeNotifier with WidgetsBindingObserver {
  AppState({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));

  final FlutterSecureStorage _storage;
  final GatewayApi api = GatewayApi();

  AuthPhase phase = AuthPhase.booting;
  String? memberNo;
  String? firstName;
  Session? session;
  MemberBundle? bundle;
  bool loading = false;
  String? error;
  /// Message shown on the PIN screen after an automatic lock.
  String? lockReason;

  static const _idleLock = Duration(minutes: 3);
  static const _backgroundLock = Duration(seconds: 60);
  Timer? _idleTimer;
  DateTime? _backgroundedAt;

  bool get isLoggedIn => phase == AuthPhase.unlocked;

  Future<void> init() async {
    WidgetsBinding.instance.addObserver(this);
    String? key;
    try {
      key = await _storage.read(key: _kDeviceKey);
      memberNo = await _storage.read(key: _kMemberNo);
      firstName = await _storage.read(key: _kFirstName);
    } catch (_) {
      // Keystore unreadable (e.g. restored backup on a new phone): start over with activation.
      await _storage.deleteAll();
    }
    if (key == null) {
      key = GatewayApi.newDeviceKey();
      await _storage.write(key: _kDeviceKey, value: key);
    }
    api.deviceKey = key;
    phase = memberNo == null ? AuthPhase.needsActivation : AuthPhase.locked;
    notifyListeners();
  }

  // ---------------------------------------------------------------- activity / auto-lock

  /// Call on any user interaction to postpone the idle lock.
  void touch() {
    if (phase != AuthPhase.unlocked) return;
    _idleTimer?.cancel();
    _idleTimer = Timer(_idleLock, () => lock(reason: 'Locked after 3 minutes without activity.'));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      _backgroundedAt ??= DateTime.now();
    } else if (state == AppLifecycleState.resumed) {
      final away = _backgroundedAt;
      _backgroundedAt = null;
      if (away != null && DateTime.now().difference(away) > _backgroundLock) {
        lock(reason: 'Locked while the app was in the background.');
      }
    }
  }

  void lock({String? reason}) {
    if (phase != AuthPhase.unlocked) return;
    final t = api.token;
    if (t != null) api.logout().catchError((_) {});
    api.token = null;
    _idleTimer?.cancel();
    session = null;
    bundle = null;
    lockReason = reason;
    phase = AuthPhase.locked;
    notifyListeners();
  }

  // ---------------------------------------------------------------- sign-in

  Future<void> activate({required String memberNo, required String code, required String pin}) async {
    final res = await api.activate(
      memberNo: memberNo,
      code: code,
      pin: pin,
      deviceKey: api.deviceKey!,
      deviceName: 'Android phone',
    );
    final no = '${res['memberNo'] ?? memberNo}';
    await _storage.write(key: _kMemberNo, value: no);
    await _storage.write(key: _kFirstName, value: '${res['firstName'] ?? ''}');
    this.memberNo = no;
    firstName = '${res['firstName'] ?? ''}';
    await _unlocked('${res['token']}');
  }

  Future<void> unlock(String pin) async {
    final res = await api.login(memberNo: memberNo!, pin: pin, deviceKey: api.deviceKey!);
    await _unlocked('${res['token']}');
  }

  Future<void> _unlocked(String token) async {
    api.token = token;
    lockReason = null;
    phase = AuthPhase.unlocked;
    touch();
    await refreshBundle();
  }

  /// Forget this phone's registration locally (after the gateway rejected the device or the
  /// member chose to unlink it). A new activation code from the branch is needed.
  Future<void> forgetDevice() async {
    api.token = null;
    _idleTimer?.cancel();
    await _storage.delete(key: _kMemberNo);
    await _storage.delete(key: _kFirstName);
    memberNo = null;
    firstName = null;
    session = null;
    bundle = null;
    phase = AuthPhase.needsActivation;
    notifyListeners();
  }

  Future<void> deregister() async {
    try {
      await api.deregister();
    } finally {
      await forgetDevice();
    }
  }

  /// Handle an API error from any screen: an ended session locks the app.
  bool handleSessionError(Object e) {
    if (e is ApiException && (e.sessionEnded || e.locked)) {
      lock(reason: e.message);
      return true;
    }
    return false;
  }

  Future<void> refreshBundle() async {
    if (!isLoggedIn) return;
    loading = true;
    error = null;
    notifyListeners();
    try {
      final (s, b) = await api.me();
      session = s;
      bundle = b;
    } catch (e) {
      if (!handleSessionError(e)) error = e.toString();
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _idleTimer?.cancel();
    super.dispose();
  }
}
