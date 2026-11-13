:- use_module(library(plunit)).
:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module(library(yall)).

:- user:consult('../rules/uniform_spend').      % relative to this file

:- begin_tests(uniform_spend, [cleanup(wipe)]).

wipe :-
    retractall(user:candidate(_, _, _, _)),
    retractall(user:service_category(_, _)),
    retractall(user:fact(_, _, _)),
    retractall(user:missing(_, _)).

% bill(Doc, Account, Service, Period, Class, Rate, Units): a fully read
% one-line document from vendor v to owner o in category cat, with the host
% having searched for an explanation and found none.
bill(D, Account, Service, Period, Class, Rate, Units) :-
    retractall(user:candidate(_, _, _, D)),
    retractall(user:fact(D, _, _)),
    maplist([F]>>assertz(user:F),
            [ candidate(o, v, cat, D),
              fact(D, superseded_by, not_stated),
              fact(D, account, Account),
              fact(D, lines, [1]),
              fact(D, line(1, service), Service),
              fact(D, line(1, period), Period),
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

% findings for service svc in period wk(1), as [Flagged, Best] pairs
findings(Fs) :- findings(svc, wk(1), Fs).
findings(S, P, Fs) :- findall([F, B], user:uniform_spend(o, v, S, P, F, B), Fs).
requests(Rs) :- findall(D-A, user:missing(D, A), Rs0), msort(Rs0, Rs).

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

test(service_and_period_are_read_before_prices, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    maplist([A]>>unread(d1, line(1, A)), [service, period, class, rate, units]),
    findings([]),
    requests(Rs), Rs == [d1-line(1, period), d1-line(1, service)].

test(service_category_narrows_documents, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    assertz(user:candidate(o, v, cat2, d3)),     % another category, unread
    assertz(user:service_category(svc, cat)),
    findings(Fs), Fs == [[d2-1, d1-1]],
    requests([]),
    findings(uncategorised, wk(1), []),          % no category known: all documents
    requests(Rs), Rs == [d3-superseded_by].

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

test(superseded_document_is_ignored, [setup(wipe), cleanup(wipe)]) :-
    bill(d1, a1, std, 10, 5),
    bill(d2, a2, std, 12, 5),
    set_fact(d2, superseded_by, d3),
    bill(d3, a2, std, 10, 5),          % the corrected version
    findings([]),
    requests([]).

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
    requests(Rs), Rs == [d3-superseded_by],
    set_fact(d3, superseded_by, not_stated),
    findings([]),
    requests(Rs2), Rs2 == [d3-account, d3-lines, d3-superseded_by].

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
               "missing\td9\tsuperseded_by",
               "" ].

:- end_tests(uniform_spend).
