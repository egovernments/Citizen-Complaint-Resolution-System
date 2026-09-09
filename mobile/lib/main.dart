import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'src/app_config.dart';
import 'src/splash_screen.dart';
import 'src/web_view_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  runApp(const CmsMozambiqueApp());
}

class CmsMozambiqueApp extends StatelessWidget {
  const CmsMozambiqueApp({super.key});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<AppConfig>(
      future: AppConfig.load(),
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const MaterialApp(
            debugShowCheckedModeBanner: false,
            home: Scaffold(
              backgroundColor: Colors.white,
              body: Center(child: CircularProgressIndicator()),
            ),
          );
        }
        final config = snapshot.data!;
        return MaterialApp(
          title: config.appName,
          debugShowCheckedModeBanner: false,
          theme: ThemeData(
            useMaterial3: true,
            colorSchemeSeed: config.primaryColor,
          ),
          home: _Bootstrap(config: config),
        );
      },
    );
  }
}

class _Bootstrap extends StatefulWidget {
  final AppConfig config;
  const _Bootstrap({required this.config});

  @override
  State<_Bootstrap> createState() => _BootstrapState();
}

class _BootstrapState extends State<_Bootstrap> {
  bool _ready = false;
  Timer? _maxTimer;

  @override
  void initState() {
    super.initState();
    _maxTimer = Timer(const Duration(seconds: 8), _markReady);
  }

  @override
  void dispose() {
    _maxTimer?.cancel();
    super.dispose();
  }

  void _markReady() {
    if (!mounted || _ready) return;
    _maxTimer?.cancel();
    setState(() => _ready = true);
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        WebViewScreen(config: widget.config, onReady: _markReady),
        IgnorePointer(
          ignoring: _ready,
          child: AnimatedOpacity(
            opacity: _ready ? 0 : 1,
            duration: const Duration(milliseconds: 400),
            child: SplashScreen(config: widget.config),
          ),
        ),
      ],
    );
  }
}
