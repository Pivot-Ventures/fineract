import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/fineract_api.dart';
import '../models/models.dart';

const _kSession = 'pivosacc_native_session';
const _kApiBase = 'pivosacc_api_base';

class AppState extends ChangeNotifier {
  AppState() {
    _api = FineractApi();
  }

  late FineractApi _api;
  FineractApi get api => _api;

  Session? session;
  MemberBundle? bundle;
  bool booting = true;
  bool loading = false;
  String? error;
  String apiBase = kDefaultApiBase;

  bool get isLoggedIn => session != null && session!.clientId > 0;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    apiBase = prefs.getString(_kApiBase) ?? kDefaultApiBase;
    _api.baseUrl = apiBase;
    final raw = prefs.getString(_kSession);
    if (raw != null) {
      try {
        session = Session.fromJson(jsonDecode(raw) as Map<String, dynamic>);
        _api.session = session;
        await refreshBundle();
      } catch (_) {
        session = null;
        _api.session = null;
      }
    }
    booting = false;
    notifyListeners();
  }

  Future<void> setApiBase(String url) async {
    var u = url.trim();
    if (u.endsWith('/')) u = u.substring(0, u.length - 1);
    // Accept either full API base or server root
    if (!u.contains('/fineract-provider/')) {
      u = '$u/fineract-provider/api/v1';
    }
    apiBase = u;
    _api.baseUrl = u;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kApiBase, u);
    notifyListeners();
  }

  Future<void> login({
    required String memberRef,
    required String pin,
    String tenantId = 'default',
  }) async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      session = await _api.memberLogin(
        memberRef: memberRef,
        pin: pin,
        tenantId: tenantId,
      );
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kSession, jsonEncode(session!.toJson()));
      await refreshBundle();
    } catch (e) {
      error = e.toString();
      rethrow;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    session = null;
    bundle = null;
    _api.session = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kSession);
    notifyListeners();
  }

  Future<void> refreshBundle() async {
    if (!isLoggedIn) return;
    loading = true;
    error = null;
    notifyListeners();
    try {
      bundle = await _api.loadMemberBundle();
      // Keep session display fields fresh
      if (session != null && bundle != null) {
        session = Session(
          username: session!.username,
          tenantId: session!.tenantId,
          authKey: session!.authKey,
          clientId: session!.clientId,
          clientName: bundle!.clientName,
          clientAccountNo: bundle!.clientAccountNo,
          clientOffice: bundle!.officeName,
          officeId: session!.officeId,
          memberRef: session!.memberRef,
        );
        _api.session = session;
      }
    } catch (e) {
      error = e.toString();
    } finally {
      loading = false;
      notifyListeners();
    }
  }
}
