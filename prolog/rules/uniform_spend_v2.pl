% uniform_spend_v2.pl -- "Ensure uniform spend", version 2.
%
% Convention: when one owner buys the same service of the same class from the
% same vendor in the same period for two or more of its accounts, each billed
% on its own document, the accounts should pay the same unit rate.  An account
% paying more than the tolerance above the owner's best rate for that same
% thing, with no stated explanation, is a finding.  A line with a stated
% explanation is neither flagged nor allowed to set the best rate.
% Precision over recall: when anything is in doubt, nothing is flagged.
%
% Changes from version 1:
%   1. A line's service and period are keys derived by a key provider from raw
%      typed facts, not stated facts compared as read.  This file does not
%      know what the keys mean.
%   2. Versions are derived, not supplied: documents of one owner and vendor that
%      state the same version_of are versions of one thing, and only the one
%      filed last counts.
%
% Facts used (all supplied by the host; this file never reads a document):
%   candidate(Owner, Vendor, Category, Doc)  routing index, known from metadata
%   service_category(Service, Category)      coarse category of a service key
%   fact(Doc, Attr, Value)                   Value is the value read, or not_stated
%       document attributes: version_of (the identifier the document states for
%                            the thing it is a version of), filed (anything that
%                            orders documents by when they were filed), account,
%                            lines (list of line numbers)
%       line attributes:     line(N, class|rate|units|explanation), and
%                            line(N, A) for every A the key provider asks for
% Key provider interface (clauses come from a separate file loaded alongside):
%   key_inputs(+KeyName, -Attrs)       KeyName is service or period; Attrs are
%                                      the line attributes that key is derived from
%   line_key(+KeyName, +Doc, +N, -Key) the derived key; fails when a needed fact
%                                      is absent, not_stated or unusable, and
%                                      the line is then ignored
% Fact written:
%   missing(Doc, Attr)   a fact the rule needs that has not been read.  An
%                        absent fact is never taken as not_stated.
% Reads are staged: version_of and filed of every document the query covers;
% then account and lines of a current document; then each line's key
% inputs; then class, rate and units of the lines the query is about; then the
% explanation of lines on either side of a gap.

:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module(library(pairs)).
:- use_module(library(yall)).
:- use_module(library(solution_sequences)).

:- dynamic candidate/4, service_category/2, fact/3, missing/2.
:- multifile key_inputs/2, line_key/4.
:- discontiguous key_inputs/2, line_key/4.

% tolerance(T): a rate is excessive when it is more than T (a fraction) above the best.
tolerance(0.10).

%!  uniform_spend(?Owner, ?Vendor, ?Service, ?Period, -Flagged, -Best) is nondet.
%   Service and Period are derived keys.  Flagged and Best are Doc-N pointers
%   to the overpaying line and to the best-rate line it is compared with.
%   Unbound arguments sweep.
uniform_spend(O, V, S, P, Flagged, Best) :-
    distinct(O-V, candidate(O, V, _, _)),
    scope_ready(O, V, S, P),
    setof(R-L-A, line(O, V, k(S, P, _Class), A, R, L), Lines),  % one group per S, P, Class
    best(Lines, Best, Gaps),
    member(AccountLines, Gaps),
    flagged(AccountLines, Flagged).

%!  finding_details(+Flagged, +Best, -Account, -Rate, -BestAccount, -BestRate, -Excess)
%   What to print about a finding, looked up from the stored facts.
finding_details(D-N, BD-BN, A, R, BA, BR, Excess) :-
    fact(D, account, A),   fact(D, line(N, rate), R), fact(D, line(N, units), U),
    fact(BD, account, BA), fact(BD, line(BN, rate), BR),
    Excess is (R - BR) * U.

% line: a priced line on a current document, keyed by service, period and class.
line(O, V, k(S, P, C), A, Rate, D-N) :-
    candidate(O, V, Cat, D),
    current(O, V, D),
    stated(D, account, A),
    fact(D, lines, Ns), is_list(Ns), member(N, Ns),
    key(service, D, N, S), in_category(S, Cat),
    key(period, D, N, P),
    fact(D, line(N, class), C),       % not_stated is a class of its own
    positive(D, line(N, rate), Rate),
    positive(D, line(N, units), _).

stated(D, Attr, V)   :- fact(D, Attr, V), V \== not_stated.
positive(D, Attr, V) :- fact(D, Attr, V), number(V), V > 0.

% key: the provider's key for a line, derived first and compared afterwards.
key(Name, D, N, Key) :- once(line_key(Name, D, N, K)), Key = K.

% in_category: a service with known categories is looked for only in those.
in_category(S, Cat) :-
    (   nonvar(S), service_category(S, _) -> \+ \+ service_category(S, Cat) ; true ).

% --- versions ------------------------------------------------------------------
% Documents of one owner and vendor that state the same version_of are versions
% of one thing; a document is superseded when another of them was filed later.
% A document that states no version_of is a version of nothing else, and so is
% current.  Versions are looked for among the documents the query covers.

current(O, V, D) :- \+ superseded(O, V, D).

superseded(O, V, D) :-
    stated(D, version_of, Id), fact(D, filed, F),
    candidate(O, V, _, D2), D2 \== D,
    stated(D2, version_of, Id2), Id2 == Id,
    fact(D2, filed, F2), F2 @> F.

version_known(D) :- all_known(D, [version_of, filed]).

% --- the gap and its explanations -------------------------------------------
% best(+Lines, -Best, -Gaps): Lines are Rate-Line-Account in ascending order
% (ties: standard order of Doc-N).  The lowest line is the prospective best.
% Gaps holds, for each other account whose lowest line is over the tolerance,
% that account's lines in ascending order.  Without a gap nothing is asked or
% found.  With one, the explanations of both sides are requested; an explained
% best line is dropped and the next lowest line is tried in its place.
best([R-B-A|Ls], Best, Gaps) :-
    tolerance(T),
    findall(A1-L, (member(_-L-A1, Ls), A1 \== A), Others),
    keysort(Others, Sorted),                    % stable: keeps ascending rate
    group_pairs_by_key(Sorted, ByAccount),
    findall([D-N|More],
            ( member(_-[D-N|More], ByAccount),
              fact(D, line(N, rate), R1), R1 > R * (1 + T) ),
            Gs),
    Gs = [_|_],
    findall(First, member([First|_], Gs), Firsts),
    exclude(explanation_known, [B|Firsts], _),  % visits, and so requests, each
    B = BD-BN, fact(BD, line(BN, explanation), E),
    (   E == not_stated -> Best = B, Gaps = Gs ; best(Ls, Best, Gaps) ).

% flagged: an overpaying account's lowest line that has no stated explanation.
flagged([D-N|Ls], Flagged) :-
    explanation_known(D-N),
    (   fact(D, line(N, explanation), not_stated) -> Flagged = D-N
    ;   flagged(Ls, Flagged)
    ).

explanation_known(D-N) :- known(D, line(N, explanation)).

% --- absent facts -------------------------------------------------------------
% While a document the query needs is undetermined the owner/vendor pair yields
% no findings, because the unread fact could still lower a rate or change the
% best rate.  Only lines matching the queried service and period need pricing.
% Every request of a round is recorded in one pass.

scope_ready(O, V, S, P) :-
    findall(D, (candidate(O, V, Cat, D), in_category(S, Cat)), Ds0),
    sort(Ds0, Ds),
    exclude(version_known, Ds, Unversioned),    % visits every document
    Unversioned == [],                          % versions first, then the rest
    findall(D, (member(D, Ds), \+ doc_ready(O, V, D, S, P)), []).

doc_ready(O, V, D, S, P) :-
    (   current(O, V, D)                        % current version: read it
    ->  all_known(D, [account, lines]),
        (   stated(D, account, _), fact(D, lines, Ns), is_list(Ns)
        ->  key_attrs(KeyAttrs),
            findall(line(N, A), (member(N, Ns), member(A, KeyAttrs)), Keys),
            findall(line(N, A),
                    ( member(N, Ns), wanted(D, N, S, P),
                      member(A, [class, rate, units]) ),
                    Prices),
            append(Keys, Prices, Attrs),
            all_known(D, Attrs)
        ;   true                                % no account or no lines: ignored
        )
    ;   true                                    % superseded: nothing else needed
    ).

% key_attrs: every line attribute the provider derives a key from.
key_attrs(Attrs) :-
    findall(A, (member(K, [service, period]), key_inputs(K, As), member(A, As)), All),
    sort(All, Attrs).

% wanted: line N is for the queried service and period (any, when unbound).
wanted(D, N, S, P) :-
    key(service, D, N, S1), \+ S \= S1,
    key(period, D, N, P1),  \+ P \= P1.

all_known(D, Attrs) :- exclude(known(D), Attrs, Unknown), Unknown == [].   % visits every Attr

known(D, Attr) :-
    (   fact(D, Attr, _) -> true
    ;   missing(D, Attr) -> fail
    ;   assertz(missing(D, Attr)), fail
    ).

% outstanding: a request that no fact has answered yet.
outstanding(D, Attr) :- missing(D, Attr), \+ fact(D, Attr, _).

% --- report -------------------------------------------------------------------

main :-
    forall(( uniform_spend(_, _, _, _, F, B),
             finding_details(F, B, A, R, BA, BR, Excess) ),
           print_row([finding, F, B, A, R, BA, BR, Excess])),
    forall(outstanding(D, Attr), print_row([missing, D, Attr])).

print_row(Cells) :-
    maplist([C, S]>>format(atom(S), "~q", [C]), Cells, Strings),
    atomic_list_concat(Strings, '\t', Row),
    writeln(Row).
