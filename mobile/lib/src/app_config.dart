import 'dart:convert';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter/material.dart';

class AppConfig {
  final String appName;
  final String url;
  final String citizenUrl;
  final String logoAsset;
  final Color primaryColor;
  final bool allowMixedContent;
  final bool javascriptEnabled;
  final bool showAppBar;
  final bool pullToRefresh;
  final bool startWithCitizen;

  String get startUrl => startWithCitizen ? citizenUrl : url;

  const AppConfig({
    required this.appName,
    required this.url,
    required this.citizenUrl,
    required this.logoAsset,
    required this.primaryColor,
    required this.allowMixedContent,
    required this.javascriptEnabled,
    required this.showAppBar,
    required this.pullToRefresh,
    required this.startWithCitizen,
  });

  static Future<AppConfig> load() async {
    final raw = await rootBundle.loadString('assets/config/app_config.json');
    final json = jsonDecode(raw) as Map<String, dynamic>;
    return AppConfig(
      appName: json['appName'] as String? ?? 'CMS Mozambique',
      url: json['url'] as String? ??
          'http://digit.mctd.gov.mz/digit-ui/employee/user/login',
      citizenUrl: json['citizenUrl'] as String? ??
          'http://digit.mctd.gov.mz/digit-ui/citizen/login',
      logoAsset: json['logoAsset'] as String? ?? 'assets/icons/app_icon.png',
      primaryColor: _parseHex(json['primaryColorHex'] as String? ?? '#0B4F6C'),
      allowMixedContent: json['allowMixedContent'] as bool? ?? true,
      javascriptEnabled: json['javascriptEnabled'] as bool? ?? true,
      showAppBar: json['showAppBar'] as bool? ?? false,
      pullToRefresh: json['pullToRefresh'] as bool? ?? true,
      startWithCitizen: json['startWithCitizen'] as bool? ?? true,
    );
  }

  static Color _parseHex(String hex) {
    var v = hex.replaceFirst('#', '');
    if (v.length == 6) v = 'FF$v';
    return Color(int.parse(v, radix: 16));
  }
}
