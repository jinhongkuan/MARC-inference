% reconcile.pl -- "Ensure credits and replacements reconcile".
%
% Convention: when a vendor fails to deliver something an account was promised
% it credits the charge, and should make it good with a replacement of equal
% value.  Over every current document between one owner's account and one
% vendor, the value credited should be matched by the value of replacements.
% An account whose replacements are worth more than the tolerance below its
% credits is under-delivered.
% Precision over recall: while anything needed is unknown, nothing is reported.
%
% Facts used (all supplied by the host; this file never reads a document):
%   candidate(Owner, Vendor, Category, Doc)  routing index, known from metadata
%   fact(Doc, Attr, Value)                   Value is the value read, or not_stated
%       superseded_by, account   shared with uniform_spend.pl, same meaning: a
%                      superseded document, or one with no stated account, is ignored
%       adjustments    new here: list of adjustment(Line, Kind, Amount), [] if none.
%                      Kind credited: Amount is the value removed; replacement:
%                      Amount is what the make-good is billed at.  Other kinds are
%                      ignored.  A malformed list or entry is unusable and leaves
%                      the document's account undetermined.
% Fact written:
%   missing(Doc, Attr)   a fact the rule needs that has not been read.  An
%                        absent fact is never taken as not_stated.
% Reads are staged: superseded_by of every candidate of the owner and vendor;
% then account of current documents; then adjustments of current documents
% whose stated account matches the queried one (any, when unbound).
% Helpers are prefixed mg_ so both rulesets can be loaded together; only main/0
% is defined by both (the file loaded last wins).

:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module(library(yall)).
:- use_module(library(aggregate)).
:- use_module(library(solution_sequences)).

:- dynamic candidate/4, fact/3, missing/2.   % shared; redeclaring keeps their clauses

mg_tolerance(0.10).   % replacements may fall this fraction short of credits
mg_epsilon(1.0e-9).   % absolute slack: exactly that far short is never flagged

%!  under_delivered(?Owner, ?Vendor, ?Account) is nondet.
%   The finding.  Unbound arguments sweep; details come from delivery/6.
under_delivered(O, V, A) :-
    delivery(O, V, A, Credited, Replaced, _),
    mg_tolerance(T), mg_epsilon(Eps),
    Credited > 0, Replaced < Credited * (1 - T) - Eps.

%!  delivery(?Owner, ?Vendor, ?Account, -Credited, -Replaced, -Evidence) is nondet.
%   The values of one determined account, finding or not, and the sorted
%   Doc-Line pointers of its credited adjustments.
delivery(O, V, A, Credited, Replaced, Evidence) :-
    distinct(O-V, candidate(O, V, _, _)),
    mg_request(O, V, A),
    distinct(A, mg_current(O, V, A, _)),
    forall(candidate(O, V, _, D), mg_doc_known(D, A)),   % any unknown: undetermined
    setof(D, mg_current(O, V, A, D), Docs),              % each document counted once
    maplist(mg_adjustments, Docs, PerDoc), append(PerDoc, Adjs),
    mg_total(credited, Adjs, Credited), mg_total(replacement, Adjs, Replaced),
    findall(P, member(adj(P, credited, _), Adjs), Ps), sort(Ps, Evidence).

% mg_current: D is a current document of the pair billing the stated account A.
mg_current(O, V, A, D) :-
    candidate(O, V, _, D), fact(D, superseded_by, not_stated), mg_stated(D, account, A).

mg_stated(D, Attr, V) :- fact(D, Attr, V), V \== not_stated.

% mg_adjustments: the usable adjustments of D as adj(D-Line, Kind, Amount).
mg_adjustments(D, Adjs) :-
    fact(D, adjustments, L), is_list(L), maplist(mg_adjustment(D), L, Adjs).

mg_adjustment(D, adjustment(Line, Kind, Amount), adj(D-Line, Kind, Amount)) :-
    ground(Line), atom(Kind), number(Amount), Amount >= 0.

mg_total(Kind, Adjs, Sum) :- aggregate_all(sum(X), member(adj(_, Kind, X), Adjs), Sum).

% --- absent facts -------------------------------------------------------------
% Until every candidate of the pair is routed (superseded_by, then account) no
% account of the pair is determined: the unread document could belong to any
% of them.  Every request of a round is recorded in one pass.
mg_request(O, V, A) :- forall(candidate(O, V, _, D), ignore(mg_doc_known(D, A))).

% mg_doc_known: all that a query about account A needs of D has been read.
mg_doc_known(D, A) :-
    mg_known(D, superseded_by),
    (   fact(D, superseded_by, not_stated)      % current version: read it
    ->  mg_known(D, account),
        (   mg_stated(D, account, A1), \+ A \= A1
        ->  mg_known(D, adjustments)
        ;   true                                % no account, or another account's
        )
    ;   true                                    % superseded: nothing else needed
    ).

mg_known(D, Attr) :-
    (   fact(D, Attr, _) -> true
    ;   missing(D, Attr) -> fail
    ;   assertz(missing(D, Attr)), fail
    ).

% mg_outstanding: a request that no fact has answered yet.
mg_outstanding(D, Attr) :- missing(D, Attr), \+ fact(D, Attr, _).

% --- report -------------------------------------------------------------------
main :-
    forall(order_by([asc(O), asc(V), asc(A)], delivery(O, V, A, C, R, _)),
           mg_print_row([account, O, V, A, C, R])),
    forall(order_by([asc(O), asc(V), asc(A)], under_delivered(O, V, A)),
           mg_print_row([under_delivered, O, V, A])),
    forall(order_by([asc(D), asc(Attr)], mg_outstanding(D, Attr)),
           mg_print_row([missing, D, Attr])).

mg_print_row(Cells) :-
    maplist([C, S]>>format(atom(S), "~q", [C]), Cells, Strings),
    atomic_list_concat(Strings, '\t', Row),
    writeln(Row).
