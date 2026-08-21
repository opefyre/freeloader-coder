import assert from "node:assert/strict";
import test from "node:test";

import { resolveNativePickerFixture } from "../apps/core/src/native-picker-fixture.js";

test("native picker fixture stays disabled unless explicit non-production test hooks are enabled", () => {
  assert.equal(resolveNativePickerFixture({}), undefined);
  assert.throws(
    () =>
      resolveNativePickerFixture({
        CODKESH_NATIVE_PICKER_FIXTURE: "/tmp/pilot",
      }),
    /explicit non-production test hooks/,
  );
  assert.throws(
    () =>
      resolveNativePickerFixture(
        {
          CODKESH_ENABLE_TEST_HOOKS: "1",
          CODKESH_NATIVE_PICKER_FIXTURE: "/tmp/pilot",
          NODE_ENV: "production",
        },
        "production",
      ),
    /explicit non-production test hooks/,
  );
  assert.throws(
    () =>
      resolveNativePickerFixture({
        CODKESH_ENABLE_TEST_HOOKS: "1",
        CODKESH_NATIVE_PICKER_FIXTURE: "relative/pilot",
      }),
    /explicit non-production test hooks/,
  );
  assert.equal(
    resolveNativePickerFixture({
      CODKESH_ENABLE_TEST_HOOKS: "1",
      CODKESH_NATIVE_PICKER_FIXTURE: "/tmp/pilot",
    }),
    "/tmp/pilot",
  );
});
