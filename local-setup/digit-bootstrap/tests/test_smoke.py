"""Verify the package imports cleanly."""


def test_package_imports():
    import digit_bootstrap
    assert digit_bootstrap.__name__ == "digit_bootstrap"
