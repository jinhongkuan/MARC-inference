% Tests for rules/reconcile.pl.  Run from the prolog directory:
%   swipl -g run_tests -t halt tests/reconcile.plt

:- use_module(library(plunit)).
:- use_module(library(lists)).
:- use_module(library(apply)).
:- user:consult('../rules/reconcile').

% --- helpers --------------------------------------------------------------------

wipe :-
    retractall(user:candidate(_, _, _, _)),
    retractall(user:fact(_, _, _)),
    retractall(user:missing(_, _)).

add(Facts) :- forall(member(F, Facts), assertz(user:F)).

% doc(Owner, Vendor, Doc, Account, Adjustments): a fully read current document.
doc(O, V, D, A, Adjs, [ candidate(O, V, cat, D), fact(D, superseded_by, not_stated),
                        fact(D, account, A), fact(D, adjustments, Adjs) ]).

add_doc(O, V, D, A, Adjs) :- doc(O, V, D, A, Adjs, Fs), add(Fs).

cr(Line, Amount, adjustment(Line, credited, Amount)).
rp(Line, Amount, adjustment(Line, replacement, Amount)).

findings(Fs)    :- findall(O-V-A, under_delivered(O, V, A), Fs0), msort(Fs0, Fs).
deliveries(Ds)  :- findall(d(O, V, A, C, R, E), delivery(O, V, A, C, R, E), Ds0), msort(Ds0, Ds).
outstanding(Ms) :- findall(D-At, mg_outstanding(D, At), Ms0), msort(Ms0, Ms).
requested(Ms)   :- findall(D-At, user:missing(D, At), Ms0), msort(Ms0, Ms).
main_output(S)  :- with_output_to(string(S), main).

% one(Amounts): a single document of account a with a credit of C and, unless
% R is none, a replacement billed at R.
one(C, none) :- !, cr(1, C, X), add_doc(o, v, d1, a, [X]).
one(C, R)    :- cr(1, C, X), rp(2, R, Y), add_doc(o, v, d1, a, [X, Y]).

% --- the convention ----------------------------------------------------------------

:- begin_tests(reconcile, [setup(wipe), cleanup(wipe)]).

test(cheaper_replacement_is_a_finding, [cleanup(wipe), Fs == [o-v-a]]) :-
    add_doc(o, v, d1, a, [adjustment(3, credited, 100), adjustment(4, replacement, 60)]),
    findings(Fs).

test(delivery_details_and_evidence, [cleanup(wipe), Ds == [d(o, v, a, 150, 60, [d1-3, d1-7])]]) :-
    add_doc(o, v, d1, a, [ adjustment(7, credited, 50), adjustment(3, credited, 100),
                           adjustment(4, replacement, 60) ]),
    deliveries(Ds).

test(bound_query_is_a_check, [cleanup(wipe), nondet]) :-
    one(100, 60),
    under_delivered(o, v, a),
    \+ under_delivered(o, v, b),
    \+ under_delivered(o, w, a).

test(credit_without_replacement_is_a_finding, [cleanup(wipe), Fs == [o-v-a]]) :-
    one(100, none),
    findings(Fs).

test(free_replacement_counts_as_zero, [cleanup(wipe), Fs == [o-v-a]]) :-
    one(100, 0),
    findings(Fs).

test(equal_replacement_is_no_finding, [cleanup(wipe), Fs-Ds == []-[d(o, v, a, 100, 100, [d1-1])]]) :-
    one(100, 100),
    findings(Fs), deliveries(Ds).

test(greater_replacement_is_no_finding, [cleanup(wipe), Fs == []]) :-
    one(100, 140),
    findings(Fs).

test(exactly_ten_percent_below_is_no_finding, [cleanup(wipe), Fs == []]) :-
    one(100, 90),
    findings(Fs).

test(exactly_ten_percent_below_survives_float_rounding, [cleanup(wipe), Fs == []]) :-
    0.99 < 1.1 * (1 - 0.10),                    % the bare comparison would flag
    one(1.1, 0.99),
    findings(Fs).

test(just_beyond_ten_percent_is_a_finding, [cleanup(wipe), Fs == [o-v-a]]) :-
    one(100, 89.99),
    findings(Fs).

test(replacement_on_another_document_makes_good, [cleanup(wipe), Fs-Ds == []-[d(o, v, a, 100, 100, [d1-1])]]) :-
    cr(1, 100, X), rp(5, 100, Y),
    add_doc(o, v, d1, a, [X]),
    add_doc(o, v, d2, a, [Y]),
    findings(Fs), deliveries(Ds).

test(same_documents_under_different_accounts, [cleanup(wipe), Fs-Ds == [o-v-a]-[d(o, v, a, 100, 0, [d1-1]), d(o, v, b, 0, 100, [])]]) :-
    cr(1, 100, X), rp(5, 100, Y),
    add_doc(o, v, d1, a, [X]),
    add_doc(o, v, d2, b, [Y]),
    findings(Fs), deliveries(Ds).

test(other_vendor_and_owner_do_not_make_good, [cleanup(wipe), Fs == [o-v-a]]) :-
    cr(1, 100, X), rp(5, 100, Y),
    add_doc(o, v, d1, a, [X]),
    add_doc(o, w, d2, a, [Y]),
    add_doc(p, v, d3, a, [Y]),
    findings(Fs).

test(superseded_adjustments_are_ignored, [cleanup(wipe), Fs-Ds-Ms == [o-v-a]-[d(o, v, a, 100, 0, [d2-1])]-[]]) :-
    cr(1, 100, X), rp(5, 100, Y),
    add_doc(o, v, d2, a, [X]),
    add([ candidate(o, v, cat, d1), fact(d1, superseded_by, d2),     % old version, with
          fact(d1, account, a), fact(d1, adjustments, [X, Y]) ]),    % facts left over
    add([ candidate(o, v, cat, d0), fact(d0, superseded_by, d1) ]),  % never read further
    findings(Fs), deliveries(Ds), requested(Ms).

test(unknown_kinds_are_ignored, [cleanup(wipe), Ds == [d(o, v, a, 100, 100, [d1-1])]]) :-
    add_doc(o, v, d1, a, [ adjustment(1, credited, 100), adjustment(2, replacement, 100),
                           adjustment(3, surcharge, 500), adjustment(4, discount, 40) ]),
    deliveries(Ds).

test(no_credits_is_no_finding_but_an_account, [cleanup(wipe), Fs-Ds == []-[d(o, v, a, 0, 0, []), d(o, v, b, 0, 30, [])]]) :-
    rp(2, 30, Y),
    add_doc(o, v, d1, a, []),
    add_doc(o, v, d2, b, [Y]),
    findings(Fs), deliveries(Ds).

test(document_in_two_categories_counts_once, [cleanup(wipe), Ds == [d(o, v, a, 100, 95, [d1-1])]]) :-
    one(100, 95),
    add([candidate(o, v, other_cat, d1)]),
    deliveries(Ds).

% --- staged requests and the host loop ----------------------------------------------

test(requests_are_staged_for_a_bound_account, [cleanup(wipe)]) :-
    add([candidate(o, v, cat, d1), candidate(o, v, cat, d2), candidate(o, v, cat, d3)]),
    \+ under_delivered(o, v, a),
    outstanding(M1), M1 == [d1-superseded_by, d2-superseded_by, d3-superseded_by],
    add([ fact(d1, superseded_by, not_stated), fact(d2, superseded_by, not_stated),
          fact(d3, superseded_by, d2) ]),
    \+ under_delivered(o, v, a),
    outstanding(M2), M2 == [d1-account, d2-account],             % not the superseded d3
    add([fact(d1, account, a), fact(d2, account, b)]),
    \+ under_delivered(o, v, a),
    outstanding(M3), M3 == [d1-adjustments],                     % not account b's d2
    add([fact(d1, adjustments, [adjustment(1, credited, 100)])]),
    findings(_),                                                 % the sweep now wants d2
    outstanding(M4), M4 == [d2-adjustments],
    findall(A, under_delivered(o, v, A), As), As == [a],         % a is final already
    add([fact(d2, adjustments, [])]),
    findings(Fs), Fs == [o-v-a],
    outstanding(M5), M5 == [],
    requested(All), length(All, 7).                              % each asked exactly once

test(unbound_account_requests_every_stated_account, [cleanup(wipe), Ms == [d1-adjustments, d2-adjustments]]) :-
    add([ candidate(o, v, cat, d1), fact(d1, superseded_by, not_stated), fact(d1, account, a),
          candidate(o, v, cat, d2), fact(d2, superseded_by, not_stated), fact(d2, account, b) ]),
    findings([]),
    outstanding(Ms).

test(a_round_records_every_request_once, [cleanup(wipe), Ms == [d1-superseded_by, d2-account, d3-adjustments]]) :-
    add([ candidate(o, v, cat, d1),
          candidate(o, v, cat, d2), fact(d2, superseded_by, not_stated),
          candidate(o, v, cat, d3), fact(d3, superseded_by, not_stated), fact(d3, account, a) ]),
    findings([]), findings([]), deliveries([]), main_output(_),
    requested(Ms).

test(undetermined_until_every_adjustment_is_read, [cleanup(wipe)]) :-
    cr(1, 100, X), rp(5, 100, Y),
    add_doc(o, v, d1, a, [X]),
    add_doc(o, v, d3, b, [X]),
    add([candidate(o, v, cat, d2), fact(d2, superseded_by, not_stated), fact(d2, account, a)]),
    deliveries(D1), D1 == [d(o, v, b, 100, 0, [d3-1])],          % a withheld, b unaffected
    findings(F1), F1 == [o-v-b],
    outstanding(M1), M1 == [d2-adjustments],
    add([fact(d2, adjustments, [Y])]),                           % the host answers
    deliveries(D2), D2 == [d(o, v, a, 100, 100, [d1-1]), d(o, v, b, 100, 0, [d3-1])],
    findings(F2), F2 == [o-v-b],
    outstanding(M2), M2 == [].

test(absent_account_blocks_every_account_of_the_pair, [cleanup(wipe)]) :-
    cr(1, 100, X),
    add_doc(o, v, d1, a, [X]),
    add_doc(o, v, d2, b, [X]),
    add_doc(o, w, d4, a, [X]),
    add([candidate(o, v, cat, d3), fact(d3, superseded_by, not_stated)]),
    deliveries(Ds), Ds == [d(o, w, a, 100, 0, [d4-1])],          % only the other pair
    \+ under_delivered(o, v, a), \+ under_delivered(o, v, b),
    outstanding(Ms), Ms == [d3-account].

test(absent_superseded_by_blocks_every_account_of_the_pair, [cleanup(wipe), Ds-Ms == []-[d2-superseded_by]]) :-
    one(100, none),
    add([candidate(o, v, cat, d2)]),
    deliveries(Ds), outstanding(Ms).

test(not_stated_account_is_ignored_without_a_request, [cleanup(wipe), Ds-Ms == [d(o, v, a, 100, 0, [d1-1])]-[]]) :-
    one(100, none),
    add([candidate(o, v, cat, d2), fact(d2, superseded_by, not_stated), fact(d2, account, not_stated)]),
    deliveries(Ds), requested(Ms).

test(malformed_adjustments_leave_the_account_undetermined,
     [ forall(member(Bad, [ not_stated, oops, [adjustment(1, credited, 100)|_], [oops],
                            [adjustment(1, credited)], [adjustment(1, credited, -5)],
                            [adjustment(1, credited, lots)], [adjustment(1, credited, _)],
                            [adjustment(1, "credited", 5)], [adjustment(_, credited, 5)],
                            [adjustment(1, surcharge, unknown)] ])),
       cleanup(wipe), Ds-Fs-Ms == [d(o, v, b, 100, 0, [d3-1])]-[o-v-b]-[] ]) :-
    cr(1, 100, X),
    add_doc(o, v, d1, a, [X]),
    add_doc(o, v, d2, a, Bad),                   % spoils account a, good document and all
    add_doc(o, v, d3, b, [X]),
    deliveries(Ds), findings(Fs), requested(Ms).

% --- order independence and the report ------------------------------------------------

scenario(Facts) :-
    cr(1, 100, C), rp(2, 60, R60), rp(9, 100, R100),
    doc(o, v, d1, a, [C, R60], F1),
    doc(o, v, d2, 'B 2', [C], F2),
    doc(o, v, d3, 'B 2', [R100], F3),
    doc(o, w, d4, a, [], F4),
    append([ F1, F2, F3, F4,
             [candidate(o, v, cat, d5), fact(d5, superseded_by, d1), fact(d5, adjustments, [R100])],
             [candidate(p, v, cat, d6)] ], Facts).

report(Facts, r(Fs, Ds, Ms, Out)) :-
    wipe, add(Facts),
    findings(Fs), deliveries(Ds), main_output(Out), outstanding(Ms).

test(results_do_not_depend_on_arrival_order, [cleanup(wipe)]) :-
    scenario(Facts),
    report(Facts, R1),
    reverse(Facts, Reversed), report(Reversed, R2),
    partition([F]>>(F = candidate(_, _, _, _)), Facts, Index, Read),
    reverse(Read, DaeR), append(Index, DaeR, Mixed), report(Mixed, R3),
    R1 == R2, R1 == R3,
    R1 = r([o-v-a], _, [d6-superseded_by], _).

test(results_do_not_depend_on_round_order, [cleanup(wipe)]) :-
    scenario(Facts),
    report(Facts, Expected),
    partition([F]>>(F = candidate(_, _, _, _)), Facts, Index, Read),
    wipe, add(Index),
    forall(member(F, Read), ( add([F]), findings(_), main_output(_) )),  % one fact a round
    findings(Fs), deliveries(Ds), main_output(Out), outstanding(Ms),
    Expected == r(Fs, Ds, Ms, Out).

test(main_output, [cleanup(wipe), Out == Expected]) :-
    scenario(Facts), add(Facts),
    main_output(Out),
    atomics_to_string([ "account\to\tv\t'B 2'\t100\t100\n",
                        "account\to\tv\ta\t100\t60\n",
                        "account\to\tw\ta\t0\t0\n",
                        "under_delivered\to\tv\ta\n",
                        "missing\td6\tsuperseded_by\n" ], Expected).

test(main_output_with_nothing_known, [cleanup(wipe), Out == ""]) :-
    main_output(Out).

:- end_tests(reconcile).
