# Projektadapter

## Zweck

Codee soll nicht raten, wie ein Projekt gebaut und getestet wird. Adapter erkennen Projekttypen und liefern sichere, benannte Commands.

## Priorität für Ralfs Projekte

1. Node / pnpm / TypeScript
2. Python / uv / pytest
3. Rust / Cargo
4. Android / Gradle
5. CMake / C++ / JUCE

## Gemeinsamer Vertrag

```text
id
display_name
detected
markers
modules
commands
diagnostic_parsers
```

Methoden:

```text
detect(workspace)
discover_modules(workspace)
list_commands(workspace)
recommended_checks(changed_files)
parse_diagnostics(command_result)
```

## NodeAdapter

Marker:

- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.json`

Commands:

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- vorhandene scripts aus `package.json`, aber nur nach Allowlist/Bestätigung

## PythonAdapter

Marker:

- `pyproject.toml`
- `uv.lock`
- `requirements.txt`

Commands:

- `uv run pytest`
- definierte Lint-/Typecheck-Commands aus Projektkonfiguration

## RustAdapter

Marker:

- `Cargo.toml`
- `Cargo.lock`

Commands:

- `cargo check`
- `cargo test`
- `cargo clippy --all-targets --all-features`

## GradleAdapter

Marker:

- `settings.gradle.kts`
- `build.gradle.kts`
- `gradlew.bat`
- `gradle/libs.versions.toml`

Windows Commands:

- `gradlew.bat projects`
- `gradlew.bat assembleDebug`
- `gradlew.bat test`
- `gradlew.bat lint`

Module aus `settings.gradle(.kts)` erkennen.

## CMakeAdapter

Marker:

- `CMakeLists.txt`
- `CMakePresets.json`

Commands bevorzugt aus Presets:

- `cmake --preset <name>`
- `cmake --build --preset <name>`
- `ctest --preset <name>`

Keine frei erfundenen Preset-Namen.

## Diagnostik

Adapter erzeugen standardisierte Diagnosen:

```text
severity
file_path optional
line optional
column optional
code optional
message
source
command_run_id
```

## Kein Arbitrary Shell

LLM wählt nur einen `command_id`.

Der Adapter löst diesen intern in Argumentliste und Arbeitsverzeichnis auf.
