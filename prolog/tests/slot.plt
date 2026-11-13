:- use_module(library(plunit)).
:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module(library(yall)).

:- dynamic user:fact/3.                         % normally declared by the rule file
:- user:consult('../lib/slot').                 % relative to this file

:- begin_tests(slot, [cleanup(wipe)]).

wipe :- retractall(user:fact(_, _, _)).

% slot(Doc, From, To, Weekdays, Start, End, Length): line 1 of Doc, fully read.
slot(D, From, To, Weekdays, Start, End, Length) :-
    retractall(user:fact(D, _, _)),
    forall(member(A-V, [ start_date-From, end_date-To, weekdays-Weekdays,
                         start_minute-Start, end_minute-End, length_seconds-Length ]),
           assertz(user:fact(D, line(1, A), V))).

% a 30-second slot from 06:00 to 10:00
slot(D, From, To, Weekdays) :- slot(D, From, To, Weekdays, 360, 600, 30).

starts(D, Date) :- wipe, assertz(user:fact(D, line(1, start_date), Date)).

service(D, Key) :- user:line_key(service, D, 1, Key).
period(D, Key)  :- user:line_key(period, D, 1, Key).
days(D, Days)   :- service(D, slot(Days, 360, 600, 30)).

% 2026-03-02 is a Monday, 2026-03-04 a Wednesday, 2026-03-08 a Sunday.

test(key_inputs) :-
    user:key_inputs(period, P), P == [start_date],
    user:key_inputs(service, S),
    S == [start_date, end_date, weekdays, start_minute, end_minute, length_seconds].

test(period_is_the_monday_of_the_week, [setup(wipe), cleanup(wipe)]) :-
    forall(member(Day, [2, 4, 8]),              % Monday, Wednesday, Sunday
           ( starts(d, date(2026, 3, Day)),
             period(d, K), K == week(date(2026, 3, 2)) )).

test(sunday_and_following_monday_differ, [setup(wipe), cleanup(wipe)]) :-
    starts(d, date(2026, 3, 8)), period(d, K1),
    starts(d, date(2026, 3, 9)), period(d, K2),
    K1 == week(date(2026, 3, 2)), K2 == week(date(2026, 3, 9)).

test(week_across_a_month_and_year_boundary, [setup(wipe), cleanup(wipe)]) :-
    starts(d, date(2025, 12, 31)), period(d, K1),
    starts(d, date(2026, 1, 1)),   period(d, K2),
    K1 == week(date(2025, 12, 29)), K2 == K1.

test(period_needs_only_start_date, [setup(wipe), cleanup(wipe)]) :-
    starts(d, date(2026, 3, 4)),
    period(d, _), \+ service(d, _).

test(period_of_bad_start_date, [setup(wipe), cleanup(wipe)]) :-
    forall(member(Bad, [not_stated, '2026-03-04', date(2026, 2, 30), date(2026, 13, 1),
                        date(2026, 3, 4.0), "4 March"]),
           ( starts(d, Bad), \+ period(d, _) )).

test(one_day_printed_weekday_agrees, [setup(wipe), cleanup(wipe)]) :-
    slot(d, date(2026, 3, 4), date(2026, 3, 4), [wed]),
    service(d, K), K == slot([3], 360, 600, 30).

test(one_day_printed_weekday_disagrees_date_wins, [setup(wipe), cleanup(wipe)]) :-
    slot(d, date(2026, 3, 4), date(2026, 3, 4), [fri]),
    days(d, Days), Days == [3].

test(one_day_weekday_missing_or_not_stated, [setup(wipe), cleanup(wipe)]) :-
    slot(d, date(2026, 3, 4), date(2026, 3, 4), []),
    days(d, Days1), Days1 == [3],
    slot(d, date(2026, 3, 4), date(2026, 3, 4), not_stated),
    days(d, Days2), Days2 == [3].

test(multi_day_printed_inside_range, [setup(wipe), cleanup(wipe)]) :-
    slot(d, date(2026, 3, 2), date(2026, 3, 4), [wed, tue]),
    days(d, Days), Days == [2, 3].

test(multi_day_printed_partly_outside_range, [setup(wipe), cleanup(wipe)]) :-
    slot(d, date(2026, 3, 2), date(2026, 3, 4), [wed, fri]),
    days(d, Days), Days == [3].

test(multi_day_printed_wholly_outside_range, [setup(wipe), cleanup(wipe)]) :-
    slot(d, date(2026, 3, 2), date(2026, 3, 4), [sat]),
    \+ service(d, _).

test(multi_day_weekdays_missing, [setup(wipe), cleanup(wipe)]) :-
    slot(d, date(2026, 3, 2), date(2026, 3, 4), []),
    \+ service(d, _),
    slot(d, date(2026, 3, 2), date(2026, 3, 4), not_stated),
    \+ service(d, _).

test(range_wraps_over_the_weekend, [setup(wipe), cleanup(wipe)]) :-
    slot(d, date(2026, 3, 7), date(2026, 3, 9), [sat, sun, mon, tue]),
    days(d, Days), Days == [1, 6, 7].

test(seven_days_or_more_cover_every_weekday, [setup(wipe), cleanup(wipe)]) :-
    slot(d, date(2026, 3, 4), date(2026, 3, 10), [sun, sat]),
    days(d, Days1), Days1 == [6, 7],
    slot(d, date(2026, 3, 4), date(2026, 4, 30), [mon, tue, wed, thu, fri, sat, sun]),
    days(d, Days2), Days2 == [1, 2, 3, 4, 5, 6, 7],
    slot(d, date(2026, 3, 4), date(2026, 3, 10), []),
    \+ service(d, _).

test(six_days_leave_one_weekday_out, [setup(wipe), cleanup(wipe)]) :-
    slot(d, date(2026, 3, 4), date(2026, 3, 9), [tue]),      % Wednesday to Monday
    \+ service(d, _).

test(out_of_range_day_does_not_change_the_key, [setup(wipe), cleanup(wipe)]) :-
    slot(d1, date(2026, 3, 4), date(2026, 3, 4), [wed]),
    slot(d2, date(2026, 3, 4), date(2026, 3, 4), [mon, tue, wed, thu, fri, sat, sun]),
    slot(d3, date(2026, 3, 2), date(2026, 3, 4), [tue, wed]),
    slot(d4, date(2026, 3, 2), date(2026, 3, 4), [tue, wed, sat]),
    service(d1, K1), service(d2, K2), K1 == K2,
    service(d3, K3), service(d4, K4), K3 == K4, K3 \== K1.

test(different_times_or_lengths_are_different_keys, [setup(wipe), cleanup(wipe)]) :-
    slot(d1, date(2026, 3, 4), date(2026, 3, 4), [wed], 360, 600, 30),
    slot(d2, date(2026, 3, 4), date(2026, 3, 4), [wed], 360, 600, 15),
    slot(d3, date(2026, 3, 4), date(2026, 3, 4), [wed], 360, 540, 30),
    service(d1, K1), service(d2, K2), service(d3, K3),
    K1 \== K2, K1 \== K3.

test(slot_past_midnight, [setup(wipe), cleanup(wipe)]) :-
    slot(d, date(2026, 3, 4), date(2026, 3, 4), [wed], 1380, 60, 30),
    service(d, K), K == slot([3], 1380, 60, 30).

test(key_is_derived_at_most_once, [setup(wipe), cleanup(wipe)]) :-
    slot(d, date(2026, 3, 2), date(2026, 3, 4), [tue, wed]),
    findall(K, service(d, K), Ks), Ks = [_],
    findall(K, period(d, K), Ps), Ps = [_].

test(end_before_start_date, [setup(wipe), cleanup(wipe)]) :-
    slot(d, date(2026, 3, 4), date(2026, 3, 3), [wed]),
    \+ service(d, _).

test(malformed_weekdays, [setup(wipe), cleanup(wipe)]) :-
    forall(member(Bad, [[funday], [wed, funday], [3], ["wed"], wed, [wed|_], [_]]),
           ( slot(d, date(2026, 3, 4), date(2026, 3, 4), Bad),
             \+ service(d, _) )).

test(malformed_dates, [setup(wipe), cleanup(wipe)]) :-
    forall(member(Bad, ['2026-03-04', date(2026, 2, 30), date(2026, 3), not_stated]),
           ( slot(d, Bad, date(2026, 3, 4), [wed]),
             \+ service(d, _),
             slot(d, date(2026, 3, 4), Bad, [wed]),
             \+ service(d, _) )).

test(malformed_minutes_and_length, [setup(wipe), cleanup(wipe)]) :-
    forall(member(Bad, [1440, -1, 360.0, '06:00', not_stated]),
           ( slot(d, date(2026, 3, 4), date(2026, 3, 4), [wed], Bad, 600, 30),
             \+ service(d, _),
             slot(d, date(2026, 3, 4), date(2026, 3, 4), [wed], 360, Bad, 30),
             \+ service(d, _) )),
    forall(member(Bad, [0, -30, 30.0, not_stated]),
           ( slot(d, date(2026, 3, 4), date(2026, 3, 4), [wed], 360, 600, Bad),
             \+ service(d, _) )),
    slot(d, date(2026, 3, 4), date(2026, 3, 4), [wed], 0, 1439, 1),
    service(d, K), K == slot([3], 0, 1439, 1).

test(absent_inputs_fail_and_assert_nothing, [setup(wipe), cleanup(wipe)]) :-
    \+ service(d, _), \+ period(d, _),          % nothing read at all
    user:key_inputs(service, Attrs),
    forall(member(A, Attrs),
           ( slot(d, date(2026, 3, 4), date(2026, 3, 4), [wed]),
             retractall(user:fact(d, line(1, A), _)),
             findall(F, user:fact(d, F, _), Before),
             \+ service(d, _),
             findall(F, user:fact(d, F, _), After), After == Before )),
    \+ catch(user:missing(_, _), error(existence_error(_, _), _), fail).

:- end_tests(slot).
