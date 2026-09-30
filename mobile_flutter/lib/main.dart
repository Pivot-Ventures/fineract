import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Default LAN URL for the Pivosacc mobile web UI (server binds 0.0.0.0:5174).
const String kDefaultBaseUrl = 'http://192.168.1.123:5174/';
const String kPrefsBaseUrlKey = 'pivosacc_base_url';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ),
  );
  final prefs = await SharedPreferences.getInstance();
  final baseUrl = prefs.getString(kPrefsBaseUrlKey) ?? kDefaultBaseUrl;
  runApp(PivosaccApp(initialUrl: baseUrl));
}

class PivosaccApp extends StatelessWidget {
  const PivosaccApp({super.key, required this.initialUrl});

  final String initialUrl;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Pivosacc',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0B6E4F),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
      ),
      home: MemberWebShell(initialUrl: initialUrl),
    );
  }
}

class MemberWebShell extends StatefulWidget {
  const MemberWebShell({super.key, required this.initialUrl});

  final String initialUrl;

  @override
  State<MemberWebShell> createState() => _MemberWebShellState();
}

class _MemberWebShellState extends State<MemberWebShell> {
  late final WebViewController _controller;
  late String _baseUrl;
  var _loading = true;
  var _progress = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    _baseUrl = widget.initialUrl;
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFFFFFFF))
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (progress) {
            if (!mounted) return;
            setState(() => _progress = progress);
          },
          onPageStarted: (_) {
            if (!mounted) return;
            setState(() {
              _loading = true;
              _error = null;
            });
          },
          onPageFinished: (_) {
            if (!mounted) return;
            setState(() => _loading = false);
          },
          onWebResourceError: (error) {
            if (!mounted) return;
            setState(() {
              _loading = false;
              _error =
                  'Could not load $_baseUrl\n${error.description}\n\n'
                  'Check that the Mac mobile server is running on :5174 '
                  'and this phone can reach the LAN IP. Long-press the title '
                  'to change the base URL.';
            });
          },
        ),
      )
      ..loadRequest(Uri.parse(_baseUrl));
  }

  Future<void> _reload() async {
    setState(() {
      _error = null;
      _loading = true;
    });
    await _controller.loadRequest(Uri.parse(_baseUrl));
  }

  Future<void> _editBaseUrl() async {
    final field = TextEditingController(text: _baseUrl);
    final next = await showDialog<String>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          title: const Text('Base URL'),
          content: TextField(
            controller: field,
            autofocus: true,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(
              hintText: 'http://192.168.1.123:5174/',
              helperText: 'Pivosacc mobile web UI (cleartext HTTP OK)',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, kDefaultBaseUrl),
              child: const Text('Reset'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, field.text.trim()),
              child: const Text('Save'),
            ),
          ],
        );
      },
    );
    if (next == null || next.isEmpty) return;
    var url = next;
    if (!url.endsWith('/')) url = '$url/';
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(kPrefsBaseUrlKey, url);
    if (!mounted) return;
    setState(() {
      _baseUrl = url;
      _error = null;
      _loading = true;
    });
    await _controller.loadRequest(Uri.parse(url));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: GestureDetector(
          onLongPress: _editBaseUrl,
          child: const Text('Pivosacc'),
        ),
        actions: [
          IconButton(
            tooltip: 'Reload',
            onPressed: _reload,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Base URL',
            onPressed: _editBaseUrl,
            icon: const Icon(Icons.link),
          ),
        ],
        bottom: _loading
            ? PreferredSize(
                preferredSize: const Size.fromHeight(2),
                child: LinearProgressIndicator(
                  value: _progress > 0 && _progress < 100
                      ? _progress / 100.0
                      : null,
                ),
              )
            : null,
      ),
      body: _error != null
          ? _ErrorPane(message: _error!, onRetry: _reload, onEditUrl: _editBaseUrl)
          : WebViewWidget(controller: _controller),
    );
  }
}

class _ErrorPane extends StatelessWidget {
  const _ErrorPane({
    required this.message,
    required this.onRetry,
    required this.onEditUrl,
  });

  final String message;
  final VoidCallback onRetry;
  final VoidCallback onEditUrl;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.wifi_off, size: 48, color: Theme.of(context).colorScheme.error),
            const SizedBox(height: 16),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: onEditUrl,
              child: const Text('Change base URL'),
            ),
          ],
        ),
      ),
    );
  }
}
