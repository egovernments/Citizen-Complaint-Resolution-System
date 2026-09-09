import 'dart:async';
import 'dart:io' show Platform;
import 'dart:math' as math;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';

import 'app_config.dart';

/// Where the user chose to pull a complaint attachment from.
enum _PickSource { camera, gallery, files }

class WebViewScreen extends StatefulWidget {
  final AppConfig config;
  final VoidCallback? onReady;
  const WebViewScreen({super.key, required this.config, this.onReady});

  @override
  State<WebViewScreen> createState() => _WebViewScreenState();
}

class _WebViewScreenState extends State<WebViewScreen>
    with WidgetsBindingObserver {
  late final WebViewController _controller;
  bool _offline = false;
  bool _hasLoadedOnce = false;
  bool _canGoBack = false;
  String _currentUrl = '';
  String? _pageError;
  DateTime? _lastBackTime;
  StreamSubscription<List<ConnectivityResult>>? _connSub;

  double _scrollY = 0;
  double _pullStartY = 0;
  double _pullDistance = 0;
  bool _refreshing = false;
  bool _calledReady = false;
  static const double _pullThreshold = 140;
  static const double _pullStart = 24;

  void _fireReady() {
    if (_calledReady) return;
    _calledReady = true;
    widget.onReady?.call();
  }

  String get _primaryHost => Uri.parse(widget.config.url).host;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initController();
    _watchConnectivity();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _connSub?.cancel();
    super.dispose();
  }

  void _initController() {
    late final PlatformWebViewControllerCreationParams params;
    if (!kIsWeb && Platform.isIOS) {
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }

    final controller = WebViewController.fromPlatformCreationParams(params)
      ..setJavaScriptMode(widget.config.javascriptEnabled
          ? JavaScriptMode.unrestricted
          : JavaScriptMode.disabled)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (url) => setState(() {
            _currentUrl = url;
            _pageError = null;
          }),
          onPageFinished: (url) {
            setState(() {
              _currentUrl = url;
              _hasLoadedOnce = true;
            });
            _refreshCanGoBack();
            _fireReady();
          },
          onWebResourceError: (err) {
            if (err.isForMainFrame != true) return;
            setState(() {
              _pageError = _describeError(err);
            });
            _refreshCanGoBack();
            _fireReady();
          },
          onHttpError: (err) {
            final code = err.response?.statusCode;
            // 4xx responses (401/403/404/validation) are handled in-page by
            // the DIGIT SPA and must never replace the page with the error
            // screen. Treating them as fatal trapped the employee in a loop
            // with no way back home (#884). Only a genuine 5xx server failure
            // is shown.
            if (code == null || code < 500) return;
            // The main document and its background API/XHR calls both report
            // here; only act when the failing request is the page itself, not
            // a data fetch the app makes after loading.
            final failedUrl = err.request?.uri.toString();
            final isMainDocument = failedUrl != null &&
                (failedUrl == _currentUrl ||
                    failedUrl == widget.config.startUrl);
            if (!isMainDocument) return;
            setState(() {
              _pageError = 'Server error ($code). Please try again later.';
            });
            _refreshCanGoBack();
            _fireReady();
          },
          onNavigationRequest: _onNavigation,
        ),
      )
      ..loadRequest(Uri.parse(widget.config.startUrl));

    if (!kIsWeb && controller.platform is AndroidWebViewController) {
      final android = controller.platform as AndroidWebViewController;
      AndroidWebViewController.enableDebugging(false);
      android.setMediaPlaybackRequiresUserGesture(false);
      // navigator.geolocation from the OSM map: ask the OS first, then answer
      // the WebView prompt accordingly (#885).
      android.setGeolocationPermissionsPromptCallbacks(
        onShowPrompt: _onGeolocationPrompt,
      );
      // <input type="file"> from the complaint form: bridge to native pickers.
      android.setOnShowFileSelector(_onShowFileSelector);
    }

    controller.setOnScrollPositionChange((pos) {
      _scrollY = pos.y;
    });

    _controller = controller;
  }

  void _onPointerDown(PointerDownEvent e) {
    _pullStartY = e.position.dy;
    if (_pullDistance != 0) {
      setState(() => _pullDistance = 0);
    }
  }

  void _onPointerMove(PointerMoveEvent e) {
    if (_refreshing) return;
    if (_scrollY > 1) {
      if (_pullDistance != 0) setState(() => _pullDistance = 0);
      return;
    }
    final delta = e.position.dy - _pullStartY;
    if (delta <= 0) {
      if (_pullDistance != 0) setState(() => _pullDistance = 0);
      return;
    }
    setState(() => _pullDistance = delta);
  }

  void _onPointerEnd(PointerEvent e) {
    if (_pullDistance >= _pullThreshold && !_refreshing) {
      _doPullRefresh();
    } else if (_pullDistance != 0) {
      setState(() => _pullDistance = 0);
    }
  }

  Future<void> _doPullRefresh() async {
    setState(() {
      _refreshing = true;
      _pullDistance = _pullThreshold;
    });
    await _reload();
    if (!mounted) return;
    setState(() {
      _refreshing = false;
      _pullDistance = 0;
    });
  }

  Future<NavigationDecision> _onNavigation(NavigationRequest req) async {
    final uri = Uri.tryParse(req.url);
    if (uri == null) return NavigationDecision.navigate;
    final scheme = uri.scheme.toLowerCase();

    if (scheme == 'mailto' || scheme == 'tel' || scheme == 'sms') {
      await _launchExternal(uri);
      return NavigationDecision.prevent;
    }

    if ((scheme == 'http' || scheme == 'https') &&
        uri.host.isNotEmpty &&
        uri.host != _primaryHost) {
      await _launchExternal(uri);
      return NavigationDecision.prevent;
    }

    return NavigationDecision.navigate;
  }

  Future<void> _launchExternal(Uri uri) async {
    try {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok && mounted) {
        _showSnack('No app available to handle this link');
      }
    } catch (_) {
      if (mounted) _showSnack('Could not open link');
    }
  }

  // ── Native permission & picker bridges (Android) ─────────────────────────

  Future<bool> _ensureLocationPermission() async {
    var status = await Permission.location.status;
    if (status.isGranted) return true;
    status = await Permission.location.request();
    if (status.isPermanentlyDenied && mounted) {
      _showSnack('Location is blocked. Enable it for this app in Settings.');
    }
    return status.isGranted;
  }

  Future<bool> _ensureCameraPermission() async {
    final status = await Permission.camera.request();
    if (status.isPermanentlyDenied && mounted) {
      _showSnack('Camera is blocked. Enable it for this app in Settings.');
    }
    return status.isGranted;
  }

  // WebView asks before honouring navigator.geolocation; we gate it on the OS
  // permission so the device prompt actually appears.
  Future<GeolocationPermissionsResponse> _onGeolocationPrompt(
    GeolocationPermissionsRequestParams request,
  ) async {
    final granted = await _ensureLocationPermission();
    return GeolocationPermissionsResponse(allow: granted, retain: granted);
  }

  Future<List<String>> _onShowFileSelector(FileSelectorParams params) async {
    final multiple = params.mode == FileSelectorMode.openMultiple;

    // Non-image inputs (PDF, docs, …): go straight to the system file picker.
    if (!_acceptsImages(params.acceptTypes)) return _pickFiles(multiple);

    // The web input asked for a direct capture (`capture` attribute).
    if (params.isCaptureEnabled) return _single(await _capturePhoto());

    switch (await _showSourceSheet(onlyImages: _onlyImages(params.acceptTypes))) {
      case _PickSource.camera:
        return _single(await _capturePhoto());
      case _PickSource.gallery:
        return _pickImages(multiple);
      case _PickSource.files:
        return _pickFiles(multiple);
      case null:
        // Dismissed: hand back an empty list so the WebView clears the input.
        return const <String>[];
    }
  }

  Future<_PickSource?> _showSourceSheet({required bool onlyImages}) {
    if (!mounted) return Future.value(null);
    return showModalBottomSheet<_PickSource>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              onTap: () => Navigator.pop(sheetContext, _PickSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.pop(sheetContext, _PickSource.gallery),
            ),
            if (!onlyImages)
              ListTile(
                leading: const Icon(Icons.attach_file),
                title: const Text('Choose a file'),
                onTap: () => Navigator.pop(sheetContext, _PickSource.files),
              ),
          ],
        ),
      ),
    );
  }

  Future<String?> _capturePhoto() async {
    if (!await _ensureCameraPermission()) return null;
    try {
      final shot = await ImagePicker()
          .pickImage(source: ImageSource.camera, imageQuality: 80);
      return shot?.path;
    } catch (_) {
      if (mounted) _showSnack('Could not open the camera');
      return null;
    }
  }

  Future<List<String>> _pickImages(bool multiple) async {
    try {
      final picker = ImagePicker();
      if (multiple) {
        final shots = await picker.pickMultiImage(imageQuality: 80);
        return shots.map((x) => _toUri(x.path)).toList();
      }
      final shot =
          await picker.pickImage(source: ImageSource.gallery, imageQuality: 80);
      return _single(shot?.path);
    } catch (_) {
      if (mounted) _showSnack('Could not open the gallery');
      return const <String>[];
    }
  }

  Future<List<String>> _pickFiles(bool multiple) async {
    try {
      final result =
          await FilePicker.platform.pickFiles(allowMultiple: multiple);
      if (result == null) return const <String>[];
      return result.paths.whereType<String>().map(_toUri).toList();
    } catch (_) {
      if (mounted) _showSnack('Could not open the file picker');
      return const <String>[];
    }
  }

  // The Android file-chooser callback expects file URIs, not bare paths.
  List<String> _single(String? path) =>
      path == null ? const <String>[] : <String>[_toUri(path)];

  String _toUri(String path) => Uri.file(path).toString();

  bool _acceptsImages(List<String> accept) =>
      accept.isEmpty || accept.any(_isImageType);

  bool _onlyImages(List<String> accept) =>
      accept.isNotEmpty && accept.every(_isImageType);

  bool _isImageType(String type) {
    final t = type.toLowerCase().trim();
    if (t.startsWith('image/')) return true;
    return const [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.webp',
      '.heic',
      '.heif',
      '.bmp',
    ].any(t.endsWith);
  }

  String _describeError(WebResourceError err) {
    switch (err.errorType) {
      case WebResourceErrorType.hostLookup:
      case WebResourceErrorType.unknown:
        return 'Could not reach the server. Check your connection and try again.';
      case WebResourceErrorType.timeout:
      case WebResourceErrorType.connect:
      case WebResourceErrorType.io:
        return 'The connection timed out. Please try again.';
      case WebResourceErrorType.failedSslHandshake:
        return 'A secure connection could not be established.';
      default:
        return 'Page failed to load. Please try again.';
    }
  }

  Future<void> _watchConnectivity() async {
    final results = await Connectivity().checkConnectivity();
    _updateOffline(results, silent: true);
    _connSub = Connectivity().onConnectivityChanged.listen(_updateOffline);
  }

  void _updateOffline(List<ConnectivityResult> results, {bool silent = false}) {
    final offline = results.every((r) => r == ConnectivityResult.none);
    if (offline == _offline) return;
    setState(() => _offline = offline);
    if (silent) return;
    if (offline) {
      _showSnack('You are offline. Some features may not work.');
    } else {
      _showSnack('Back online');
      if (_pageError != null) _reload();
    }
  }

  void _showSnack(String message) {
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    Connectivity().checkConnectivity().then((r) {
      _updateOffline(r, silent: true);
      if (!_offline && (_pageError != null || !_hasLoadedOnce)) {
        _reload();
      }
    });
  }

  Future<void> _handleBack() async {
    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return;
    }
    final now = DateTime.now();
    if (_lastBackTime != null &&
        now.difference(_lastBackTime!) < const Duration(seconds: 2)) {
      await SystemNavigator.pop();
      return;
    }
    _lastBackTime = now;
    _showSnack('Press back again to exit');
  }

  Future<void> _refreshCanGoBack() async {
    final canGoBack = await _controller.canGoBack();
    if (!mounted || canGoBack == _canGoBack) return;
    setState(() => _canGoBack = canGoBack);
  }

  Future<void> _reload() async {
    // Capture before setState clears _pageError — reading it afterwards always
    // sees null, which silently disabled the "reload from a fresh start" path.
    final freshStart = !_hasLoadedOnce;
    setState(() {
      _pageError = null;
    });
    if (freshStart) {
      await _controller.loadRequest(Uri.parse(widget.config.startUrl));
    } else {
      await _controller.reload();
    }
  }

  Future<void> _goBackFromError() async {
    if (await _controller.canGoBack()) {
      setState(() {
        _pageError = null;
      });
      await _controller.goBack();
    } else {
      await _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle(
        statusBarColor: widget.config.primaryColor,
        statusBarIconBrightness: Brightness.light,
        statusBarBrightness: Brightness.dark,
        systemNavigationBarColor: Colors.white,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: PopScope<Object?>(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (didPop) return;
          _handleBack();
        },
        child: Scaffold(
          backgroundColor: widget.config.primaryColor,
          appBar: widget.config.showAppBar
              ? AppBar(
                  backgroundColor: widget.config.primaryColor,
                  foregroundColor: Colors.white,
                  title: Text(widget.config.appName),
                  actions: [
                    IconButton(
                      icon: const Icon(Icons.refresh),
                      onPressed: _reload,
                    ),
                  ],
                )
              : null,
          body: SafeArea(
            child: _buildBody(),
          ),
        ),
      ),
    );
  }

  Widget _buildBody() {
    final errorMessage = _pageError ??
        ((!_hasLoadedOnce && _offline)
            ? 'No internet connection. Please check your network.'
            : null);
    final stack = Stack(
      children: [
        WebViewWidget(controller: _controller),
        if (widget.config.pullToRefresh &&
            (_pullDistance > _pullStart || _refreshing))
          _PullIndicator(
            color: widget.config.primaryColor,
            pullDistance: _pullDistance,
            startAt: _pullStart,
            threshold: _pullThreshold,
            refreshing: _refreshing,
          ),
        if (errorMessage != null)
          Positioned.fill(
            child: _ErrorView(
              color: widget.config.primaryColor,
              message: errorMessage,
              icon: _offline ? Icons.wifi_off : Icons.error_outline,
              onRetry: _reload,
              onBack: _canGoBack ? _goBackFromError : null,
            ),
          ),
      ],
    );

    if (!widget.config.pullToRefresh) return stack;
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: _onPointerDown,
      onPointerMove: _onPointerMove,
      onPointerUp: _onPointerEnd,
      onPointerCancel: _onPointerEnd,
      child: stack,
    );
  }
}

class _PullIndicator extends StatelessWidget {
  final Color color;
  final double pullDistance;
  final double startAt;
  final double threshold;
  final bool refreshing;

  const _PullIndicator({
    required this.color,
    required this.pullDistance,
    required this.startAt,
    required this.threshold,
    required this.refreshing,
  });

  @override
  Widget build(BuildContext context) {
    final progress =
        ((pullDistance - startAt) / (threshold - startAt)).clamp(0.0, 1.0);
    final scale = refreshing ? 1.0 : 0.6 + 0.4 * progress;
    final top = refreshing
        ? 24.0
        : (8.0 + math.min((pullDistance - startAt) * 0.25, 32.0));

    return Positioned(
      top: top,
      left: 0,
      right: 0,
      child: IgnorePointer(
        child: Center(
          child: Transform.scale(
            scale: scale,
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.18),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              alignment: Alignment.center,
              child: refreshing
                  ? SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        valueColor: AlwaysStoppedAnimation(color),
                      ),
                    )
                  : Transform.rotate(
                      angle: progress * math.pi * 1.5,
                      child: Icon(Icons.refresh, color: color, size: 22),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final Color color;
  final String message;
  final IconData icon;
  final VoidCallback onRetry;
  final VoidCallback? onBack;
  const _ErrorView({
    required this.color,
    required this.message,
    required this.icon,
    required this.onRetry,
    this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      alignment: Alignment.center,
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 64, color: color),
            const SizedBox(height: 16),
            const Text(
              'Something went wrong',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 24),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: color),
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
              onPressed: onRetry,
            ),
            if (onBack != null) ...[
              const SizedBox(height: 12),
              TextButton.icon(
                style: TextButton.styleFrom(foregroundColor: color),
                icon: const Icon(Icons.arrow_back),
                label: const Text('Go back'),
                onPressed: onBack,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
