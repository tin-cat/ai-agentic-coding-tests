# Contributing
Please feel free to contribute your tests to this repository. You can either contribute entire new tests, or your runs of existing tests.

## Contribute your run of an existing test
Create a directory under `/tests/<test name>/results/<your github username>` with a name that uniquely describe the inference provider, model and model settings. Follow the [Results directory naming convention](#results-directory-naming-convention) specified below.

Inside this directory, create one subdirectory named like the test stage you ran. Stages are specified in the `prompts.md` file for the test you're running. You'll find this file in `/tests/<test name>/prompts.md`

> Stages should run in the order their name suggest, as specified in `prompts.md`.

After running the test stage, add your results to the test's `benchmarks.md` file in `/tests/<test name>/benchmarks.md`

For example, if your github username were `anthony` and ran the first stage of the `live-message-wall` test using Claude Code Pro with Sonnet 4.6 in a "high effort" setting, you should create the directory

```
    /tests
        /live-message-wall
            /results
                /anthony
                    /claude-code-pro-sonnet-4.6-high-effort
                        /stage-1-first-run
```

And store inside the complete source code Claude outputted for your run.

You should also update `/tests/live-message-wall/benchmarks.md` with something like this:

```markdown
## `stage-1-first-run`
[...]
@anthony|claude-code-pro|sonnet-4.6|`effort:high`|7:27|26.3k|$0.63|Excellent
```

## Contribute a new test
Create a directory under `/tests` with a name that uniquely and shortly describes your test name (using `kebab-case`).

Add a `/tests/<your test name>/prompts.md` file, use [/tests/live-message-wall/prompts.md](/tests/live-message-wall/prompts.md) as a reference.

> You don't need to have the exact same stages as in the example, but it's recommended to have at least a simpler "stage-1-first-run" and then add complexity with consecutive stages to strain the model.

Create an empty `/tests/<your test name>/benchmarks.md` file, use [/tests/live-message-wall/benchmarks.md](/tests/live-message-wall/benchmarks.md) as a reference.

If you want to also contribute your runs to your new test, follow the [Contribute your run of an existing test](#contribute-your-run-of-an-existing-test) guide above.

---

### Results directory naming convention
The directories under `/tests/<test name>/results/<your github username>` must follow the syntax:

    `<provider>-<model>-<settings>`

For example:

- **provider** `claude-code`
- **model** `sonnet-4.6`
- **settings** `high-effort`

Would result in the directory name:

`/tests/<test name>/results/<your github username>/claude-code-sonnet-4.6-high-effort`
