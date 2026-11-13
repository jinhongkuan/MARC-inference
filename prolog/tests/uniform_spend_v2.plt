:- use_module(library(plunit)).
:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module(library(yall)).

:- user:consult('../rules/uniform_spend_v2').   % relative to this file

% --- test key provider ----------------------------------------------------------
% Generic on purpose, so the rule is tested without lib/slot.pl: a key is the raw
% attribute as read, except that noisy(K) stands for a second way of copying K.
% It is switched off while the integration unit at the end loads lib/slot.pl.

:- dynamic user:test_provider/0, user:tests_dir/1.
user:test_provider.
:- prolog_load_context(directory, Dir), assertz(user:tests_dir(Dir)).

user:key_inputs(service, [svc_raw]) :- test_provider.
user:key_inputs(period,  [per_raw]) :- test_provider.

user:line_key(service, D, N, Key) :- test_provider, raw_key(D, N, svc_raw, Key).
user:line_key(period,  D, N, Key) :- test_provider, raw_key(D, N, per_raw, Key).

user:raw_key(D, N, Attr, Key) :-
    fact(D, line(N, Attr), V), V \== not_stated,
    (   V = noisy(K) -> Key = K ; Key = V ).

user:wipe :-
    retractall(candidate(_, _, _, _)),
    retractall(service_category(_, _)),
    retractall(fact(_, _, _)),
    retractall(missing(_, _)).

:- begin_tests(uniform_spend_v2, [cleanup(wipe)]).

% bill(Doc, Account, RawService, RawPeriod, Class, Rate, Units): a fully read
% one-line document from vendor v to owner o in category cat, with the host
% having searched for an explanation and found none.
bill(D, Account, Service, Period, Class, Rate, Units) :-
    retractall(user:candidate(_, _, _, D)),
    retractall(user:fact(D, _, _)),
    maplist([F]>>assertz(user:F),
            [ candidate(o, v, cat, D),
              fact(D, version_of, not_stated),
              fact(D, filed, 0),
              fact(D, account, Account),
              fact(D, lines, [1]),
              fact(D, line(1, svc_raw), Service),
              fact(D, line(1, per_raw), Period),
              fact(D, line(1, class), Class),
              fact(D, line(1, rate), Rate),
              fact(D, line(1, units), Units),
              fact(D, line(1, explanation), not_stated) ]).

bill(D, Account, Class, Rate, Units) :-
    bill(D, Account, svc, wk(1), Class, Rate, Units).

set_fact(D, Attr, Value) :-
    retractall(user:fact(D, Attr, _)),
    assertz(user:fact(D, Attr, Value)).

unread(D, Attr) :- retractall(user:fact(D, Attr, _)).

% findings for service key svc in period key wk(1), as [Flagged, Best] pairs
findings(Fs) :- findings(svc, wk(1), Fs).
findings(S, P, Fs) :- findall([F, B], user:uniform_spend(o, v, S, P, F, B), Fs).
requests(Rs) :- findall(D-A, user:missing(D, A), Rs0), msort(Rs0, Rs).

% --- ported from version 1 ------------------------------------------------------

test(clear_finding_is_two_pointers, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    findings(Fs), Fs == [[d2-1, d1-1]],
    requests([]).

test(details_are_looked_up, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    once(user:finding_details(d2-1, d1-1, A, R, BA, BR, Excess)),
    [A, R, BA, BR, Excess] == [a2, 12, a1, 10, 10].

test(sweeps_unbound_arguments, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    bill(d3, a1, other, wk(2), std, 3, 1),
    bill(d4, a2, other, wk(2), std, 4, 1),
    findall(q(O, V, S, P, F, B), user:uniform_spend(O, V, S, P, F, B), L),
    L == [ q(o, v, other, wk(2), d4-1, d3-1), q(o, v, svc, wk(1), d2-1, d1-1) ].

test(lowest_rate_of_an_account_is_used, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    bill(d3, a2, std, 10, 2),          % a2 also got the best rate
    findings([]).

test(equal_rates, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 10, 5),
    findings([]).

test(gap_under_threshold, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 10.9, 5),
    findings([]).

test(gap_exactly_at_threshold, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 11, 5),          % exactly 10% is not "more than 10%"
    findings([]).

test(different_class, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, priority, 12, 5),
    findings([]).

test(unstated_class_compares_only_with_unstated_class, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, not_stated, 12, 5),
    findings([]),
    bill(d3, a3, not_stated, 15, 5),
    findings(Fs), Fs == [[d3-1, d2-1]].

test(bound_service_ignores_other_services, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    bill(d3, a3, other, wk(1), std, 1, 5),       % cheaper, but another service
    maplist([A]>>unread(d3, line(1, A)), [class, rate, units]),
    findings(Fs), Fs == [[d2-1, d1-1]],
    requests([]),                                % nothing asked about d3's price
    findings(_, wk(1), []),                      % the sweep does need it
    requests(Rs), Rs == [d3-line(1, class), d3-line(1, rate), d3-line(1, units)].

test(bound_period_ignores_other_periods, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    bill(d3, a3, svc, wk(2), std, 1, 5),         % cheaper, but another period
    maplist([A]>>unread(d3, line(1, A)), [class, rate, units]),
    findings(Fs), Fs == [[d2-1, d1-1]],
    requests([]),
    findings(svc, wk(2), []),
    requests(Rs), Rs == [d3-line(1, class), d3-line(1, rate), d3-line(1, units)].

test(service_category_narrows_documents, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    assertz(user:candidate(o, v, cat2, d3)),     % another category, unread
    assertz(user:service_category(svc, cat)),    % stated for the derived key
    findings(Fs), Fs == [[d2-1, d1-1]],
    requests([]),
    findings(uncategorised, wk(1), []),          % no category known: all documents
    requests(Rs), Rs == [d3-filed, d3-version_of].

test(explanation_requested_only_for_a_gap, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 10.5, 5),
    bill(d3, a3, std, 11, 5),
    maplist([D]>>unread(D, line(1, explanation)), [d1, d2, d3]),
    findings([]),
    requests([]),                                % no gap: nothing to explain
    set_fact(d3, line(1, rate), 12),
    findings([]),                                % a gap, but undetermined
    requests(Rs), Rs == [d1-line(1, explanation), d3-line(1, explanation)],
    set_fact(d3, line(1, explanation), not_stated),
    findings([]),                                % best line still unanswered
    set_fact(d1, line(1, explanation), not_stated),
    findings(Fs), Fs == [[d3-1, d1-1]],
    \+ user:outstanding(_, _),
    requests(Rs).                                % d2 was never asked about

test(explained_flagged_line, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    set_fact(d2, line(1, explanation), clause(7)),
    findings([]).

test(explained_flagged_line_falls_back_to_next_line, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    bill(d3, a2, std, 13, 5),
    set_fact(d2, line(1, explanation), clause(7)),
    unread(d3, line(1, explanation)),
    findings([]),
    requests(Rs), Rs == [d3-line(1, explanation)],
    set_fact(d3, line(1, explanation), not_stated),
    findings(Fs), Fs == [[d3-1, d1-1]].

test(explained_best_line_changes_the_finding, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 8, 5),
    bill(d2, a2, std, 10, 5),
    bill(d3, a3, std, 12, 5),
    findings(Fs0), Fs0 == [[d2-1, d1-1], [d3-1, d1-1]],
    set_fact(d1, line(1, explanation), special_term),
    findings(Fs), Fs == [[d3-1, d2-1]].

test(explained_best_line_removes_the_finding, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 8, 5),
    bill(d2, a2, std, 10, 5),
    bill(d3, a3, std, 10.5, 5),
    set_fact(d1, line(1, explanation), special_term),
    findings([]).

test(next_best_is_asked_in_turn, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 6, 5),
    bill(d2, a2, std, 8, 5),
    bill(d3, a3, std, 12, 5),
    set_fact(d1, line(1, explanation), special_term),
    unread(d2, line(1, explanation)),
    findings([]),
    requests(Rs), Rs == [d2-line(1, explanation)],
    set_fact(d2, line(1, explanation), not_stated),
    findings(Fs), Fs == [[d3-1, d2-1]].

test(all_other_accounts_explained, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 8, 5),
    bill(d2, a2, std, 10, 5),
    bill(d3, a3, std, 12, 5),
    set_fact(d1, line(1, explanation), special_term),
    set_fact(d2, line(1, explanation), clause(2)),
    findings([]).

test(same_findings_whatever_order_facts_arrive, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 8, 5),
    bill(d2, a2, std, 10, 5),
    bill(d3, a3, std, 12, 5),
    maplist([D]>>unread(D, line(1, explanation)), [d1, d2, d3]),
    findings([]),
    set_fact(d3, line(1, explanation), not_stated),   % answered last-first
    findings([]),
    set_fact(d2, line(1, explanation), not_stated),
    findings([]),
    set_fact(d1, line(1, explanation), special_term),
    findings(Fs), Fs == [[d3-1, d2-1]].

test(absent_fact_is_requested_not_assumed, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    unread(d2, line(1, units)),
    findings([]),
    findings([]),                      % rerun: the request is recorded once
    requests(Rs), Rs == [d2-line(1, units)],
    assertz(user:fact(d2, line(1, units), 5)),   % the host answers
    findings(Fs), Fs == [[d2-1, d1-1]],
    \+ user:outstanding(_, _).

test(unread_document_requests_only_what_is_needed, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    assertz(user:candidate(o, v, cat, d3)),      % indexed, nothing read yet
    findings([]),
    requests(Rs), Rs == [d3-filed, d3-version_of],
    set_fact(d3, version_of, not_stated),
    set_fact(d3, filed, 0),
    findings([]),
    requests(Rs2), Rs2 == [d3-account, d3-filed, d3-lines, d3-version_of].

test(not_stated_is_not_a_request, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    set_fact(d2, line(1, rate), not_stated),
    findings([]),
    requests([]).

test(zero_or_negative_is_ignored, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 0, 5),           % a zero rate is not a best rate
    bill(d2, a2, std, 12, 5),
    bill(d3, a3, std, 10, -1),
    findings([]).

test(main_prints_findings_then_requests, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    assertz(user:candidate(o2, v, cat, d9)),     % another owner, unread
    with_output_to(string(Out), user:main),
    split_string(Out, "\n", "", Lines),
    Lines == [ "finding\td2-1\td1-1\ta2\t12\ta1\t10\t10",
               "missing\td9\tversion_of",
               "missing\td9\tfiled",
               "" ].

% --- derived keys ---------------------------------------------------------------

test(key_inputs_are_read_before_prices, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    maplist([A]>>unread(d1, line(1, A)), [svc_raw, per_raw, class, rate, units]),
    findings([]),
    requests(Rs), Rs == [d1-line(1, per_raw), d1-line(1, svc_raw)].   % exactly the provider's inputs

test(stated_service_and_period_are_never_read, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    set_fact(d2, line(1, service), elsewhere),   % version 1 facts carry no weight
    set_fact(d2, line(1, period), wk(9)),
    findings(Fs), Fs == [[d2-1, d1-1]],
    requests([]).

test(same_key_from_different_raw_facts_is_compared, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, svc, noisy(wk(1)), std, 10, 5),
    bill(d2, a2, noisy(svc), wk(1), std, 12, 5),
    findings(Fs), Fs == [[d2-1, d1-1]],
    findall(S-P, user:uniform_spend(o, v, S, P, _, _), Keys), Keys == [svc-wk(1)].

test(line_without_a_key_is_ignored_without_a_request, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    bill(d3, a3, not_stated, wk(1), std, 1, 5),  % cheapest, but of no known service
    bill(d4, a4, svc, not_stated, std, 1, 5),    % cheapest, but of no known period
    forall(( member(D, [d3, d4]), member(A, [class, rate, units]) ), unread(D, line(1, A))),
    findall([F, B], user:uniform_spend(o, v, _, _, F, B), Fs),   % even in a sweep
    Fs == [[d2-1, d1-1]],
    requests([]).

% --- versions ------------------------------------------------------------------

test(later_version_supersedes, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    bill(d3, a2, std, 10, 5),          % the corrected version
    set_fact(d2, version_of, x), set_fact(d2, filed, 1),
    set_fact(d3, version_of, x), set_fact(d3, filed, 2),
    findings([]),
    set_fact(d3, filed, 0),            % filed first instead: d2 is the current one
    findings(Fs), Fs == [[d2-1, d1-1]],
    requests([]).

test(superseded_document_is_not_read_further, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d3, a2, std, 12, 5),
    set_fact(d3, version_of, x), set_fact(d3, filed, 2),
    maplist([F]>>assertz(user:F),
            [ candidate(o, v, cat, d2),          % only its version facts are read
              fact(d2, version_of, x),
              fact(d2, filed, 1) ]),
    findings(Fs), Fs == [[d3-1, d1-1]],
    requests([]).                                % no account, lines or line fact

test(version_does_not_depend_on_the_account, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    bill(d3, a2_misread, std, 12, 5),  % the same thing, its account read differently
    set_fact(d2, version_of, x), set_fact(d2, filed, 1),
    set_fact(d3, version_of, x), set_fact(d3, filed, 2),
    findings(Fs), Fs == [[d3-1, d1-1]].          % flagged once, on the current version

test(different_or_unstated_versions_are_all_current, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    bill(d3, a3, std, 12, 5),
    set_fact(d2, version_of, x), set_fact(d2, filed, 1),
    set_fact(d3, version_of, y), set_fact(d3, filed, 2),
    findings(Fs), Fs == [[d2-1, d1-1], [d3-1, d1-1]],
    set_fact(d2, version_of, not_stated),
    set_fact(d3, version_of, not_stated),        % not_stated matches nothing
    findings(Fs).

test(same_filing_supersedes_neither, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    bill(d3, a2, std, 13, 5),
    set_fact(d2, version_of, x), set_fact(d2, filed, 1),
    set_fact(d3, version_of, x), set_fact(d3, filed, 1),
    findings(Fs), Fs == [[d2-1, d1-1]].          % both current; the account's lowest line

test(version_of_another_owner_does_not_supersede, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    bill(d3, a2, std, 10, 5),
    retractall(user:candidate(_, _, _, d3)),
    assertz(user:candidate(o2, v, cat, d3)),
    set_fact(d2, version_of, x), set_fact(d2, filed, 1),
    set_fact(d3, version_of, x), set_fact(d3, filed, 2),
    findings(Fs), Fs == [[d2-1, d1-1]].

test(versions_are_read_before_anything_else, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    unread(d2, account),
    assertz(user:candidate(o, v, cat, d3)),      % unread: could supersede either
    findings([]),
    findings([]),
    requests(Rs), Rs == [d3-filed, d3-version_of].   % requested once; d2's account waits

:- end_tests(uniform_spend_v2).

% --- integration with lib/slot.pl -----------------------------------------------

:- begin_tests(uniform_spend_v2_with_slot, [setup(use_slot), cleanup(drop_slot)]).

slot_file(File) :- user:tests_dir(Dir), atom_concat(Dir, '/../lib/slot.pl', File).

use_slot :-
    wipe,
    retractall(user:test_provider),
    slot_file(File), user:consult(File).

drop_slot :-
    wipe,
    slot_file(File), unload_file(File),
    assertz(user:test_provider).

% spot(Doc, Account, Weekdays, Rate): a one-line document for a 30-second slot
% from 06:00 to 10:00 on Wednesday 4 March 2026, with the weekday as printed.
spot(D, Account, Weekdays, Rate) :-
    maplist([F]>>assertz(user:F),
            [ candidate(o, v, cat, D),
              fact(D, version_of, not_stated),
              fact(D, filed, 0),
              fact(D, account, Account),
              fact(D, lines, [1]),
              fact(D, line(1, start_date), date(2026, 3, 4)),
              fact(D, line(1, end_date), date(2026, 3, 4)),
              fact(D, line(1, weekdays), Weekdays),
              fact(D, line(1, start_minute), 360),
              fact(D, line(1, end_minute), 600),
              fact(D, line(1, length_seconds), 30),
              fact(D, line(1, class), std),
              fact(D, line(1, rate), Rate),
              fact(D, line(1, units), 5),
              fact(D, line(1, explanation), not_stated) ]).

test(same_slot_printed_two_ways_is_compared, [setup(wipe), cleanup(wipe)]) :-
    spot(d1, a1, [wed], 10),
    spot(d2, a2, [mon, tue, wed, thu, fri, sat, sun], 12),
    findall(q(S, P, F, B), user:uniform_spend(o, v, S, P, F, B), L),
    L == [ q(slot([3], 360, 600, 30), week(date(2026, 3, 2)), d2-1, d1-1) ],
    \+ user:missing(_, _).

test(slot_inputs_are_requested, [setup(wipe), cleanup(wipe)]) :-
    spot(d1, a1, [wed], 10),
    retractall(user:fact(d1, line(1, _), _)),
    \+ user:uniform_spend(o, v, _, _, _, _),
    findall(A, user:missing(d1, line(1, A)), As0), msort(As0, As),
    As == [end_date, end_minute, length_seconds, start_date, start_minute, weekdays].

:- end_tests(uniform_spend_v2_with_slot).
