# Test management (QA)

The **Test management (QA)** plugin brings what TestRail or Qase do to Nootion: test cases written in advance,
test runs that go through them, and a result for each case, on one or several products at once (for a game:
PC, Xbox Series X, PS5…).

Everything is kept in ordinary Nootion databases: filter, sort, group, chart or export the cases and results like any
other database, and share them like any other page.

## Turning it on

An administrator turns on **Test management (QA)** in **Administration › Plugins**. There is nothing else to set up,
unless you link it to Azure DevOps (below).

## Azure DevOps

In the plugin's settings:

- **Azure DevOps organization**: its address, e.g. `https://dev.azure.com/my-org` (or your Azure DevOps Server's
  collection address);
- **Azure DevOps project** (optional): the project of the work items, for the links;
- **Personal access token** (optional): a token with the **Work Items (Read)** scope, made in Azure DevOps under
  User settings › Personal access tokens. With it, the block shows each ticket's title and state.

A result then takes an **Azure DevOps ticket**: just its number (`1234` or `#1234`; a pasted work item address works
too). The grid shows 🐞1234 under the result, which opens the work item, with its title and state when hovered.
A link to a ticket elsewhere can still be given instead. The ticket numbers are kept in the **Ticket** column of the
**Results** database.

The token is the administrator's: anyone who can record results sees the title and state of the work items whose
numbers they type. Make it with an account that only sees the projects being tested.

## The databases

In a page, type `/test run`, then **Create the test databases here**. Four databases are added under the page:

| Database | What it holds | Columns |
|---|---|---|
| 🧪 **Test cases** | One row per case. Write the steps in the case's page. | Suite, Priority, Preconditions, Expected result, Tags |
| 🎮 **Products** | What the cases run on: PC, Xbox, PS5, a browser… Optional. | |
| 🏃 **Test runs** | One row per run. | Version, Status (In progress / Done), Started, Finished |
| ✅ **Results** | One row per case and product of a run. | Run, Case, Product, Status, Tester, Tested on, Comment, Ticket, Bug |

Cases, products and runs each list their results (two-way relations), so a case's page shows its whole history.

Add the suites you need as options of the **Suite** column (Menus, Flight, Multiplayer…), then write your cases.
Columns can be renamed, and new ones added: the plugin finds its columns by their id, not their name. Don't delete
them, or change the option ids of **Status**.

Several sets of databases can live side by side (one per project): each `/test run` block remembers which set it uses,
and a new block offers the sets you can open.

## A run

In a `/test run` block, choose a name, the version or build being tested, and which cases to run: some **suites** and
**priorities** (none picked means all of them), on some **products** (each case is then run once per product; without
products, once). **Start the run** creates the results, all "Untested".

The block then shows the run:

- a progress bar for the whole run, and one per product, with how many passed, failed, are blocked or skipped;
- a grid with a line per case (by suite) and a column per product. Click a result to set its status (or press
  **1** Passed, **2** Failed, **3** Blocked, **4** Skipped, **5** Untested), write a comment or paste a link to the
  bug. Who set it and when is kept;
- **Add new cases**: cases written since the run started, in its suites and priorities, are added to it;
- **Finish the run** (it can be opened again). A finished run can't be changed from the block.

The grid refreshes on its own every 20 seconds, so several testers can work on the same run. Readers of the page see
the run without changing it; on a public page, the block shows the run's figures as they were last seen by an editor.

To start another run, add another `/test run` block (one block per run keeps their history in the page), or use
**Start another run here** at the bottom of the block. All runs stay in the **Test runs** database.

## Rights

The plugin reads and writes the databases as the person using it: they see the runs only if they can open the
databases, and record results only if they can edit the **Results** database.

## Limits

- A run holds at most 3,000 results (cases × products).
- The block has no view across runs yet: for that, use the databases themselves, for example a chart widget on the
  **Results** database grouped by **Status**, filtered by **Product**.
