"""Pytest configuration and fixtures for tuju-ai tests."""

import os
import pytest

from tuju_ai.llm.fake import FakeLLMClient


@pytest.fixture(autouse=True)
def _mock_llm_for_ta_fa_tests(monkeypatch):
    """Auto-patch _get_llm_client to use FakeLLMClient for all tests.
    
    This ensures tests don't try to use real OpenRouter API keys.
    Individual tests can override this with monkeypatch if needed.
    """
    import tuju_ai.ta_fa_analysis
    monkeypatch.setattr(tuju_ai.ta_fa_analysis, "_get_llm_client", lambda: FakeLLMClient())
    
    os.environ["OPENROUTER_API_KEY"] = "test-key-for-testing"
    os.environ["LLM_MODEL"] = "test-model"
    
    yield
    
    os.environ.pop("OPENROUTER_API_KEY", None)
    os.environ.pop("LLM_MODEL", None)



