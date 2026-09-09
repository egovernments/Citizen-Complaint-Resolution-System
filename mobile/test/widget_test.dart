import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mozambique/main.dart';

void main() {
  testWidgets('App boots without throwing', (WidgetTester tester) async {
    await tester.pumpWidget(const CmsMozambiqueApp());
    await tester.pump();
    expect(find.byType(CmsMozambiqueApp), findsOneWidget);
  });
}
