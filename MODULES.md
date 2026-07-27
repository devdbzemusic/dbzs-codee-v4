# DBZS MODULE VAULT

## Philosophy

All systems should be reusable whenever possible.

## Module Standards

Every module must support:

- metadata
- versioning
- dependencies
- isolated testing
- registry integration

## Folder Structure

modules/
  category/
    module-name/
      manifest.json
      src/
      tests/
      docs/

## Rules

- avoid duplicated logic
- keep modules project-neutral
- use composition over inheritance
- separate interfaces from implementations
