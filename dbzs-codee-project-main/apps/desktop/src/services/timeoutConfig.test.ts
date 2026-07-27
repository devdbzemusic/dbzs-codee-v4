/**
 * P2 Phase 6: Unit Tests for Timeout Configuration (Phase 2)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  TimeoutManager,
  selectTimeoutProfile,
  DEFAULT_TIMEOUTS,
  applySettingsTimeoutOverrides,
  applyCpuSafeTimeoutOverrides,
  residentSlotTimeoutOverrides,
  shouldApplySlowInferenceTimeouts
} from "@/services/timeoutConfig";
import type { TaskType, ModelTargetAgent } from "@/services/modelSelectionBroker";

describe("timeoutConfig", () => {
  describe("TimeoutManager", () => {
    let manager: TimeoutManager;

    beforeEach(() => {
      manager = new TimeoutManager();
    });

    describe("stage-specific timeouts", () => {
      it("should return routing stage timeout", () => {
        const timeout = manager.getRouting();
        expect(timeout).toBeGreaterThan(0);
        expect(timeout).toBeLessThanOrEqual(5000);
      });

      it("should return bootstrap stage timeout", () => {
        const timeout = manager.getBootstrap();
        expect(timeout).toBeGreaterThan(0);
        expect(timeout).toBeLessThanOrEqual(30000);
      });

      it("should return context stage timeout", () => {
        const timeout = manager.getContext();
        expect(timeout).toBeGreaterThan(0);
        expect(timeout).toBeLessThanOrEqual(30000);
      });

      it("should return first-token stage timeout", () => {
        const timeout = manager.getFirstToken();
        expect(timeout).toBeGreaterThan(0);
        // First token timeout should be significant (slow models)
        expect(timeout).toBeGreaterThanOrEqual(30000);
      });

      it("should return total request timeout", () => {
        const timeout = manager.getTotal();
        expect(timeout).toBeGreaterThan(0);
        // Total should be largest (e.g., 30 minutes for heavy work)
        expect(timeout).toBeGreaterThanOrEqual(manager.getFirstToken());
      });
    });

    describe("timeout progression", () => {
      it("uses positive independent phase budgets below the total cap", () => {
        const routing = manager.getRouting();
        const bootstrap = manager.getBootstrap();
        const context = manager.getContext();
        const firstToken = manager.getFirstToken();
        const total = manager.getTotal();

        expect(routing).toBeGreaterThan(0);
        expect(bootstrap).toBeGreaterThan(0);
        expect(context).toBeGreaterThan(0);
        expect(firstToken).toBeGreaterThan(0);
        expect(total).toBeGreaterThanOrEqual(
          Math.max(routing, bootstrap, context, firstToken)
        );
      });
    });

    describe("profile switching", () => {
      it("DEFAULT profile should have moderate timeouts", () => {
        const defaultConfig = selectTimeoutProfile("coding", null);
        
        // Lokale CPU-/Hybridmodelle benötigen ein konservatives Budget.
        expect(defaultConfig.firstToken).toBeGreaterThanOrEqual(50000);
        expect(defaultConfig.firstToken).toBeLessThanOrEqual(120000);
      });

      it("AGGRESSIVE profile should have shorter timeouts", () => {
        const aggressiveConfig = selectTimeoutProfile("completion", null);
        const defaultConfig = selectTimeoutProfile("coding", null);

        expect(aggressiveConfig.firstToken).toBeLessThan(defaultConfig.firstToken);
      });

      it("EXTENDED profile should have longer timeouts", () => {
        const extendedConfig = selectTimeoutProfile("debug", null);
        const defaultConfig = selectTimeoutProfile("coding", null);

        expect(extendedConfig.firstToken).toBeGreaterThan(defaultConfig.firstToken);
      });
    });
  });

  describe("selectTimeoutProfile", () => {
    it("should select DEFAULT for regular coding tasks", () => {
      const config = selectTimeoutProfile("coding", null);
      expect(config).toHaveProperty("firstToken");
      expect(config).toHaveProperty("routing");
    });

    it("should select AGGRESSIVE for quick tasks", () => {
      const config = selectTimeoutProfile("completion", null);
      expect(config.firstToken).toBeLessThan(DEFAULT_TIMEOUTS.firstToken);
    });

    it("should select EXTENDED for heavy tasks like debugging", () => {
      const config = selectTimeoutProfile("debug", null);
      expect(config.firstToken).toBeGreaterThan(DEFAULT_TIMEOUTS.firstToken);
    });

    it("should select EXTENDED for large context", () => {
      const config = selectTimeoutProfile(null, 15000); // Large context
      expect(config.firstToken).toBeGreaterThanOrEqual(DEFAULT_TIMEOUTS.firstToken);
    });

    it("should return TimeoutConfig with all required fields", () => {
      const config = selectTimeoutProfile("coding", null);
      
      expect(config).toHaveProperty("routing");
      expect(config).toHaveProperty("bootstrap");
      expect(config).toHaveProperty("context");
      expect(config).toHaveProperty("transport");
      expect(config).toHaveProperty("firstToken");
      expect(config).toHaveProperty("total");
    });
  });

  describe("timeout accuracy", () => {
    it("DEFAULT timeouts should be predictable", () => {
      const manager = new TimeoutManager();

      const routing = manager.getRouting();
      const bootstrap = manager.getBootstrap();
      const context = manager.getContext();
      const firstToken = manager.getFirstToken();
      const total = manager.getTotal();

      // Values should be stable across calls
      expect(manager.getRouting()).toBe(routing);
      expect(manager.getBootstrap()).toBe(bootstrap);
      expect(manager.getContext()).toBe(context);
      expect(manager.getFirstToken()).toBe(firstToken);
      expect(manager.getTotal()).toBe(total);
    });

    it("all values should be positive integers", () => {
      const manager = new TimeoutManager();

      expect(Number.isInteger(manager.getRouting())).toBe(true);
      expect(Number.isInteger(manager.getBootstrap())).toBe(true);
      expect(Number.isInteger(manager.getContext())).toBe(true);
      expect(Number.isInteger(manager.getFirstToken())).toBe(true);
      expect(Number.isInteger(manager.getTotal())).toBe(true);

      expect(manager.getRouting()).toBeGreaterThan(0);
      expect(manager.getBootstrap()).toBeGreaterThan(0);
      expect(manager.getContext()).toBeGreaterThan(0);
      expect(manager.getFirstToken()).toBeGreaterThan(0);
      expect(manager.getTotal()).toBeGreaterThan(0);
    });
  });

  describe("first-token timer", () => {
    it("first-token timeout should be large enough for slow models", () => {
      const extendedConfig = selectTimeoutProfile("debug", null);
      const firstTokenTimeout = extendedConfig.firstToken;

      // Extended profile should allow at least 1 minute
      expect(firstTokenTimeout).toBeGreaterThanOrEqual(60000);
    });

    it("first-token timeout should be less than total timeout", () => {
      const manager = new TimeoutManager();
      const firstToken = manager.getFirstToken();
      const total = manager.getTotal();

      expect(firstToken).toBeLessThanOrEqual(total);
    });

    it("should handle multiple consecutive requests with consistent timeouts", () => {
      const manager1 = new TimeoutManager();
      const manager2 = new TimeoutManager();

      expect(manager1.getFirstToken()).toBe(manager2.getFirstToken());
    });
  });

  describe("timeout boundaries", () => {
    it("should not allow negative timeouts", () => {
      const manager = new TimeoutManager();

      expect(manager.getRouting()).toBeGreaterThan(0);
      expect(manager.getBootstrap()).toBeGreaterThan(0);
      expect(manager.getContext()).toBeGreaterThan(0);
      expect(manager.getFirstToken()).toBeGreaterThan(0);
      expect(manager.getTotal()).toBeGreaterThan(0);
    });

    it("should not allow unreasonably large timeouts", () => {
      const extendedConfig = selectTimeoutProfile("debug", null);

      // Even extended profile shouldn't exceed reasonable limits
      expect(extendedConfig.total).toBeLessThan(2 * 60 * 60 * 1000); // 2 hours max
    });

    it("total timeout should be meaningful", () => {
      const manager = new TimeoutManager();
      const total = manager.getTotal();

      // Total should be at least 30 minutes
      expect(total).toBeGreaterThanOrEqual(30 * 60 * 1000); // 30 min
    });
  });

  describe("profile-specific behavior", () => {
    it("AGGRESSIVE profile should prioritize responsiveness", () => {
      const aggressiveConfig = selectTimeoutProfile("completion", null);
      const aggressive1 = aggressiveConfig.firstToken;
      const aggressive2 = aggressiveConfig.context;

      // Context timeout shouldn't be too much larger than first token
      expect(aggressive2 - aggressive1).toBeLessThan(30000); // Not more than 30s difference
    });

    it("EXTENDED profile should accommodate slow models", () => {
      const extendedConfig = selectTimeoutProfile("debug", null);
      const firstToken = extendedConfig.firstToken;

      // Extended should give at least 2 minutes for first token
      expect(firstToken).toBeGreaterThanOrEqual(120000);
    });
  });

  describe("settings overrides", () => {
    it("applies user base timeout settings in seconds", () => {
      const next = applySettingsTimeoutOverrides(DEFAULT_TIMEOUTS, {
        timeoutStreamIdleSeconds: 90,
        timeoutFirstTokenSeconds: 150,
        timeoutGenerationSeconds: 420,
        timeoutPromptEvalSeconds: 110
      });
      expect(next.streamIdle).toBe(90_000);
      expect(next.firstToken).toBe(150_000);
      expect(next.generation).toBe(420_000);
      expect(next.promptEval).toBe(110_000);
    });

    it("raises cpu-safe timeouts from settings without lowering base", () => {
      const next = applyCpuSafeTimeoutOverrides(
        { ...DEFAULT_TIMEOUTS, streamIdle: 200_000, firstToken: 50_000 },
        {
          timeoutCpuSafeStreamIdleSeconds: 180,
          timeoutCpuSafeFirstTokenSeconds: 120,
          timeoutCpuSafeGenerationSeconds: 600
        }
      );
      expect(next.streamIdle).toBe(200_000);
      expect(next.firstToken).toBe(270_000); // raised to match cpu-safe prompt-eval floor (270s)
      expect(next.generation).toBe(600_000);
      expect(next.promptEval).toBe(270_000);
    });

    it("resident overrides only clear model-load budget", () => {
      const overrides = residentSlotTimeoutOverrides();
      expect(overrides).toEqual({ modelLoad: 0 });
      const next = { ...DEFAULT_TIMEOUTS, ...overrides };
      expect(next.modelLoad).toBe(0);
      expect(next.firstToken).toBe(DEFAULT_TIMEOUTS.firstToken);
      expect(next.promptEval).toBe(DEFAULT_TIMEOUTS.promptEval);
    });

    it("flags slow inference for cpu and thin hybrid offload", () => {
      expect(shouldApplySlowInferenceTimeouts(0)).toBe(true);
      expect(shouldApplySlowInferenceTimeouts(4)).toBe(true);
      expect(shouldApplySlowInferenceTimeouts(8)).toBe(true);
      expect(shouldApplySlowInferenceTimeouts(16)).toBe(false);
      expect(shouldApplySlowInferenceTimeouts(null)).toBe(false);
    });
  });
});
