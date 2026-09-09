import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'app_config.dart';

class SplashScreen extends StatelessWidget {
  final AppConfig config;
  const SplashScreen({super.key, required this.config});

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
      ),
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: Stack(
            children: [
              Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Image.asset(config.logoAsset, width: 160, height: 160),
                    const SizedBox(height: 24),
                    Text(
                      config.appName,
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w600,
                        color: config.primaryColor,
                      ),
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: 28,
                      height: 28,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        valueColor:
                            AlwaysStoppedAnimation(config.primaryColor),
                      ),
                    ),
                  ],
                ),
              ),
              const Positioned(
                left: 0,
                right: 0,
                bottom: 16,
                child: _VersionLabel(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _VersionLabel extends StatelessWidget {
  const _VersionLabel();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<PackageInfo>(
      future: PackageInfo.fromPlatform(),
      builder: (context, snap) {
        if (!snap.hasData) return const SizedBox.shrink();
        final info = snap.data!;
        return Center(
          child: Text(
            'v ${info.version} (${info.buildNumber})',
            style: TextStyle(
              fontSize: 11,
              color: Colors.grey.shade500,
              letterSpacing: 0.3,
            ),
          ),
        );
      },
    );
  }
}
