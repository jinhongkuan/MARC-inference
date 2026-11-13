% slot.pl -- key provider for uniform_spend_v2: lines that buy a recurring
% time slot.
%
% This file is deliberately not generic.  It is the one place that knows how a
% slot is identified, so that the same slot copied two ways off two documents
% still gets one key.  The dates are trusted over the printed weekdays.
%
% Facts used: fact(Doc, line(N, Attr), Value), declared by the rule file, with
%   start_date, end_date        date(Y, M, D), first and last day covered
%   weekdays                    list of mon..sun as printed; [] or not_stated
%                               when not printed or not readable
%   start_minute, end_minute    0..1439 after midnight; an end before the start
%                               is a slot running past midnight
%   length_seconds              positive integer
% Interface defined (and nothing else the rule file defines):
%   key_inputs(+KeyName, -Attrs)
%   line_key(+KeyName, +Doc, +N, -Key)
%       period:  week(date(Y, M, D)), the Monday of the week of start_date
%       service: slot(Days, StartMinute, EndMinute, LengthSeconds), Days a
%                sorted list of weekday numbers, Monday 1 to Sunday 7
%   A key is not derived, and line_key fails, when an input is absent,
%   not_stated or malformed.

:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module(library(ordsets)).
:- use_module(library(date)).

:- multifile key_inputs/2, line_key/4.
:- discontiguous key_inputs/2, line_key/4.

key_inputs(period,  [start_date]).
key_inputs(service, [start_date, end_date, weekdays,
                     start_minute, end_minute, length_seconds]).

line_key(period, D, N, week(Monday)) :-
    input(D, N, start_date, Date),
    monday(Date, Monday).
line_key(service, D, N, slot(Days, Start, End, Length)) :-
    input(D, N, start_date, From),
    input(D, N, end_date, To),
    input(D, N, weekdays, Printed),
    input(D, N, start_minute, Start), minute(Start),
    input(D, N, end_minute, End),     minute(End),
    input(D, N, length_seconds, Length), integer(Length), Length > 0,
    range(From, To, Range),
    days(Printed, Range, Days).

input(D, N, Attr, V) :- once(fact(D, line(N, Attr), V)).

minute(M) :- integer(M), between(0, 1439, M).

% days(+Printed, +Range, -Days): the printed weekdays that fall inside the
% dates.  When none does, or none is printed, a one-day range decides.
days(Printed, Range, Days) :-
    (   Printed == not_stated -> Stated = []
    ;   is_list(Printed), maplist(weekday, Printed, Numbers), sort(Numbers, Stated)
    ),
    ord_intersection(Stated, Range, Common),
    (   Common = [_|_] -> Days = Common
    ;   Range = [_]    -> Days = Range
    ).

weekday(Name, Number) :-
    atom(Name),
    nth1(Number, [mon, tue, wed, thu, fri, sat, sun], Name), !.

% range(+From, +To, -Weekdays): the weekdays from From to To inclusive, all
% seven when that is a week or more.  Fails when To is before From.
range(From, To, Weekdays) :-
    day(From, First, W),
    day(To, Last, _),
    Span is min(Last - First, 6), Span >= 0,
    numlist(0, Span, Offsets),
    maplist(weekday_after(W), Offsets, Days),
    sort(Days, Weekdays).

weekday_after(W, Offset, Day) :- Day is (W - 1 + Offset) mod 7 + 1.

% monday(+Date, -Monday): the Monday of Date's Monday-to-Sunday week.
monday(date(Y, M, D), date(Y1, M1, D1)) :-
    day(date(Y, M, D), _, W),
    D0 is D - (W - 1),                          % day 0 or below is normalised
    date_time_stamp(date(Y, M, D0, 0, 0, 0, 0, -, -), Stamp),
    stamp_date_time(Stamp, date(Y1, M1, D1, _, _, _, _, _, _), 'UTC').

% day(+Date, -DayNumber, -Weekday): days since the epoch and weekday 1..7 of a
% real calendar date.  Fails on anything else, such as 30 February.
day(date(Y, M, D), DayNumber, Weekday) :-
    maplist(integer, [Y, M, D]),
    date_time_stamp(date(Y, M, D, 0, 0, 0, 0, -, -), Stamp),
    stamp_date_time(Stamp, date(Y, M, D, _, _, _, _, _, _), 'UTC'),
    DayNumber is round(Stamp / 86400),
    day_of_the_week(date(Y, M, D), Weekday).
