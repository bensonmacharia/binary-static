const moment               = require('moment');
const ViewPopupUI          = require('./view_popup.ui');
const BinarySocket         = require('../../socket');
const Highchart            = require('../../trade/charts/highchart');
const TickDisplay          = require('../../trade/tick_trade');
const showLocalTimeOnHover = require('../../../base/clock').showLocalTimeOnHover;
const toJapanTimeIfNeeded  = require('../../../base/clock').toJapanTimeIfNeeded;
const setViewPopupTimer    = require('../../../base/clock').setViewPopupTimer;
const localize             = require('../../../base/localize').localize;
const State                = require('../../../base/storage').State;
const urlFor               = require('../../../base/url').urlFor;
const createElement        = require('../../../base/utility').createElement;
const getPropertyValue     = require('../../../base/utility').getPropertyValue;
const isEmptyObject        = require('../../../base/utility').isEmptyObject;
const jpClient             = require('../../../common_functions/country_base').jpClient;
const addComma             = require('../../../common_functions/currency').addComma;
const formatMoney          = require('../../../common_functions/currency').formatMoney;

const ViewPopup = (() => {
    let contract_id,
        contract,
        is_sold,
        is_sell_clicked,
        chart_started,
        chart_init,
        chart_updated,
        sell_text_updated,
        btn_view,
        $container,
        $loading;

    const popupbox_id  = 'inpage_popup_content_box';
    const wrapper_id   = 'sell_content_wrapper';
    const hidden_class = 'invisible';

    const init = (button) => {
        btn_view          = button;
        contract_id       = $(btn_view).attr('contract_id');
        contract          = {};
        is_sold           = false;
        is_sell_clicked   = false;
        chart_started     = false;
        chart_init        = false;
        chart_updated     = false;
        sell_text_updated = false;
        $container        = '';

        if (btn_view) {
            ViewPopupUI.disableButton($(btn_view));
            ViewPopupUI.cleanup();
        }

        getContract();

        setLoadingState(true);
    };

    const responseContract = (response) => {
        if (!response.proposal_open_contract || isEmptyObject(response.proposal_open_contract)) {
            showErrorPopup(response);
            return;
        }
        // In case of error such as legacy shortcode, this call is returning the error message
        // but no error field. To specify those cases, we check for other fields existence
        if (!getPropertyValue(response, ['proposal_open_contract', 'shortcode'])) {
            showErrorPopup(response, response.proposal_open_contract.validation_error);
            return;
        }

        $.extend(contract, response.proposal_open_contract);

        if (contract && document.getElementById(wrapper_id)) {
            update();
            return;
        }

        showContract();
    };

    const showContract = () => {
        setLoadingState(false);

        if (!$container) {
            $container = makeTemplate();
        }

        containerSetText('trade_details_contract_id', contract.contract_id);

        containerSetText('trade_details_start_date', toJapanTimeIfNeeded(epochToDateTime(contract.date_start)));
        if (document.getElementById('trade_details_end_date')) containerSetText('trade_details_end_date', toJapanTimeIfNeeded(epochToDateTime(contract.date_expiry)));
        containerSetText('trade_details_payout', formatMoney(contract.currency, contract.payout));
        containerSetText('trade_details_purchase_price', formatMoney(contract.currency, contract.buy_price));

        setViewPopupTimer(updateTimers);
        update();
        ViewPopupUI.repositionConfirmation();

        if (State.get('is_mb_trading')) {
            State.call('ViewPopup.onDisplayed');
        }
    };

    const update = () => {
        const final_price      = contract.sell_price || contract.bid_price;
        const is_started       = !contract.is_forward_starting || contract.current_spot_time > contract.date_start;
        const user_sold        = contract.sell_time && contract.sell_time < contract.date_expiry;
        const is_ended         = contract.is_settleable || contract.is_sold || user_sold;
        const indicative_price = final_price && is_ended ? final_price : (contract.bid_price || null);

        if (contract.barrier_count > 1) {
            containerSetText('trade_details_barrier', addComma(contract.high_barrier), '', true);
            containerSetText('trade_details_barrier_low', addComma(contract.low_barrier), '', true);
        } else if (contract.barrier) {
            const formatted_barrier = addComma(contract.barrier);
            const mapping           = {
                DIGITMATCH: 'Equals',
                DIGITDIFF : 'Not',
            };
            const contract_text     = mapping[contract.contract_type];
            const barrier_prefix    = contract_text ? `${localize(contract_text)} ` : '';
            containerSetText(
                'trade_details_barrier',
                contract.entry_tick_time ? (barrier_prefix + formatted_barrier) : '-',
                '',
                true);
        }

        let current_spot      = contract.current_spot;
        let current_spot_time = contract.current_spot_time;
        if (is_ended) {
            current_spot      = user_sold ? '' : contract.exit_tick;
            current_spot_time = user_sold ? '' : contract.exit_tick_time;
        }

        if (current_spot) {
            containerSetText('trade_details_current_spot > span', addComma(current_spot));
        } else {
            $('#trade_details_current_spot').parent().setVisibility(0);
        }

        if (current_spot_time) {
            if (window.time && current_spot_time > window.time.unix()) {
                window.time = moment(current_spot_time).utc();
                updateTimers();
            }
            containerSetText('trade_details_current_date', toJapanTimeIfNeeded(epochToDateTime(current_spot_time)));
        } else {
            $('#trade_details_current_date').parent().setVisibility(0);
        }

        containerSetText('trade_details_ref_id', contract.transaction_ids.buy + (contract.transaction_ids.sell ? ` - ${contract.transaction_ids.sell}` : ''));
        containerSetText('trade_details_indicative_price', indicative_price ? formatMoney(contract.currency, indicative_price) : '-');

        let profit_loss,
            percentage;

        if (final_price) {
            profit_loss = final_price - contract.buy_price;
            percentage  = addComma((profit_loss * 100) / contract.buy_price, 2);
            containerSetText('trade_details_profit_loss',
                `${formatMoney(contract.currency, profit_loss)}<span class="percent">(${(percentage > 0 ? '+' : '')}${percentage}%)</span>`, { class: (profit_loss >= 0 ? 'profit' : 'loss') });
        } else {
            containerSetText('trade_details_profit_loss', '-', { class: 'loss' });
        }

        if (!is_started) {
            containerSetText('trade_details_entry_spot > span', '-');
            containerSetText('trade_details_message', localize('Contract has not started yet'));
        } else {
            if (contract.entry_spot > 0) {
                containerSetText('trade_details_entry_spot > span', addComma(contract.entry_spot));
            }
            containerSetText('trade_details_message', contract.validation_error ? contract.validation_error : '&nbsp;');
        }

        if (!chart_started && !contract.tick_count) {
            if (!chart_init) {
                chart_init = true;
                Highchart.showChart(contract);
            }
            Highchart.showChart(contract, 'update');
            if (contract.entry_tick_time) {
                chart_started = true;
            }
        } else if (contract.tick_count && !chart_updated) {
            TickDisplay.updateChart('', contract);
            chart_updated = true;
        }

        if (!is_sold && user_sold) {
            is_sold = true;
            if (!contract.tick_count) Highchart.showChart(contract, 'update');
        }
        if (is_ended) {
            contractEnded(parseFloat(profit_loss) >= 0);
            if (contract.is_valid_to_sell && contract.is_settleable && !contract.is_sold && !is_sell_clicked) {
                ViewPopupUI.forgetStreams();
                BinarySocket.send({ sell_expired: 1 }).then((response) => {
                    getContract(response);
                });
            }
            if (!contract.tick_count) Highchart.showChart(contract, 'update');
        }

        if (!contract.is_valid_to_sell) {
            $container.find('#errMsg').setVisibility(0);
        }

        sellSetVisibility(!is_sell_clicked && !is_sold && !is_ended && +contract.is_valid_to_sell === 1);
        contract.chart_validation_error = contract.validation_error;
        contract.validation_error       = '';
    };

    // This is called by clock.js in order to sync time updates on header as well as view popup
    const updateTimers = () => {
        const now = Math.max(Math.floor((window.time || 0) / 1000), contract.current_spot_time || 0);
        containerSetText('trade_details_live_date', toJapanTimeIfNeeded(epochToDateTime(now)));
        showLocalTimeOnHover('#trade_details_live_date');

        const is_started = !contract.is_forward_starting || contract.current_spot_time > contract.date_start;
        const is_ended   = contract.is_settleable || contract.is_sold;
        if ((!is_started || is_ended || now >= contract.date_expiry) && document.getElementById('trade_details_live_remaining')) {
            containerSetText('trade_details_live_remaining', '-');
        } else {
            let remained = contract.date_expiry - now;
            let days = 0;
            const day_seconds = 24 * 60 * 60;
            if (remained > day_seconds) {
                days = Math.floor(remained / day_seconds);
                remained %= day_seconds;
            }
            if (document.getElementById('trade_details_live_remaining')) {
                containerSetText('trade_details_live_remaining',
                    (days > 0 ? `${days} ${localize(days > 1 ? 'days' : 'day')}, ` : '') +
                    moment((remained) * 1000).utc().format('HH:mm:ss'));
            }
        }
    };

    const contractEnded = () => {
        containerSetText('trade_details_current_title', localize(contract.sell_spot_time < contract.date_expiry ? 'Contract Sold' : 'Contract Expiry'));
        containerSetText('trade_details_spot_label', localize('Exit Spot'));
        containerSetText('trade_details_spottime_label', localize('Exit Spot Time'));
        containerSetText('trade_details_indicative_label', localize('Price'));
        // show validation error if contract is not settled yet
        if (!(contract.is_settleable && !contract.is_sold)) {
            containerSetText('trade_details_message', '&nbsp;');
        }
        $container.find('#errMsg').setVisibility(0);
        sellSetVisibility(false);
        // showWinLossStatus(is_win);
        // don't show for japanese clients or contracts that are manually sold before starting
        if (!jpClient() && (!contract.sell_spot_time || contract.sell_spot_time > contract.date_start)) {
            initAuditTable(0);
        }
    };

    const appendAuditLink = (element_id) => {
        const link = createElement('a', { href: `${'java'}${'script:;'}`, class: 'link-audit button-secondary' });
        const span = createElement('span', { text: localize('Audit') });
        link.appendChild(span);
        link.addEventListener('click', () => { initAuditTable(1); });
        document.getElementById(element_id).appendChild(link);
    };

    // by default shows audit table and hides chart
    const setAuditVisibility = (show = true) => {
        setAuditButtonsVisibility(!show);
        document.getElementById('sell_details_chart_wrapper').setVisibility(!show);
        document.getElementById('sell_details_audit').setVisibility(show);
        ViewPopupUI.repositionConfirmation();
    };

    const setAuditButtonsVisibility = (show = true) => {
        const links = document.getElementsByClassName('link-audit');
        for (let i = 0; i < links.length; i++) {
            links[i].setVisibility(show);
        }
    };

    const initAuditTable = (show) => {
        if (document.getElementById('sell_details_audit')) {
            if (show) {
                setAuditVisibility(1);
            } else {
                setAuditButtonsVisibility(1);
            }
            return;
        }

        const div         = createElement('div', { id: 'sell_details_audit', class: 'gr-8 gr-12-m gr-no-gutter invisible' });
        const table       = createElement('table', { id: 'audit_header', class: 'gr-12' });
        const tr          = createElement('tr', { class: 'gr-row' });
        const th_previous = createElement('th', { class: 'gr-2 gr-3-t gr-3-p gr-3-m' });
        const link        = createElement('a', { class: 'previous-wrapper' });

        link.appendChild(createElement('span', { class: 'previous align-self-center' }));
        link.appendChild(createElement('span', { class: 'nowrap', text: localize('View Chart') }));
        link.addEventListener('click', () => { setAuditVisibility(0); });
        th_previous.appendChild(link);

        tr.appendChild(th_previous);
        tr.appendChild(createElement('th', { class: 'gr-8 gr-6-t gr-6-p gr-6-m', text: localize('Audit Page') }));
        tr.appendChild(createElement('th', { class: 'gr-2 gr-3-t gr-3-p gr-3-m' }));
        table.appendChild(tr);
        populateAuditTable(show);

        div.appendChild(table);

        let explanation_section = 'explain_';
        if (/expiry/i.test(contract.contract_type)) {
            explanation_section += 'endsinout';
        } else if (/asian/i.test(contract.contract_type)) {
            explanation_section += 'asian';
        } else if (/even|odd/i.test(contract.contract_type)) {
            explanation_section += 'evenodd';
        } else if (/over|under/i.test(contract.contract_type)) {
            explanation_section += 'overunder';
        } else if (/digit/i.test(contract.contract_type)) {
            explanation_section += 'digits';
        } else if (/upordown|range/i.test(contract.contract_type)) {
            explanation_section += 'staysinout';
        } else if (/touch/i.test(contract.contract_type)) {
            explanation_section += 'touchnotouch';
        } else if (/call|put/i.test(contract.contract_type)) {
            explanation_section += +contract.entry_tick === +contract.barrier ? 'risefall' : 'higherlower';
        }
        const xhttp = new XMLHttpRequest();
        xhttp.onreadystatechange = function() {
            if (this.readyState !== 4 || this.status !== 200) {
                return;
            }
            const div_response = createElement('div', { html: this.responseText });
            const div_to_show = div_response.querySelector(`#${explanation_section}`);
            if (div_to_show) {
                div_to_show.classList.add('align-start', 'gr-padding-20', 'explanation-section', 'gr-parent');
                div.appendChild(div_to_show);
                div_to_show.setVisibility(1);
            }
        };
        xhttp.open('GET', urlFor('explanation'), true);
        xhttp.send();

        div.insertAfter(document.getElementById('sell_details_chart_wrapper'));
    };

    const parseTicksResponse = (table, response, tick_time, remark) => (
        new Promise((resolve) => {
            if (!response.history) {
                return;
            }
            let has_start_time = !/entry/i.test(remark);
            let has_end_time   = !/exit/i.test(remark);
            const secondary_classes = ['fill-bg-color', 'secondary-time'];
            response.history.times.forEach((time, idx) => {
                if (+time === +tick_time) {
                    let i = idx - 3;
                    for (i; i < idx + 4; i++) {
                        const this_time     = response.history.times[i];
                        const this_price    = response.history.prices[i];
                        const is_start_time = +this_time === +contract.date_start;
                        const is_end_time   = +this_time === +contract.date_expiry;

                        if (!has_start_time && +this_time > +contract.date_start) {
                            createAuditRow(table, contract.date_start, '', localize('Start Time'), secondary_classes);
                            has_start_time = true;
                        } else if (!has_end_time && +this_time > +contract.date_expiry) {
                            createAuditRow(table, contract.date_expiry, '', localize('End Time'), secondary_classes);
                            has_end_time = true;
                        }

                        let pre_remark = is_end_time ? 'End Time and' : '';
                        if (is_start_time) {
                            pre_remark = 'Start Time and';
                        }

                        if (i === idx) {
                            createAuditRow(table, this_time, this_price, localize(`${pre_remark} ${remark}`), ['secondary-bg-color', 'content-inverse-color', 'align-self-center']);
                        } else if (is_start_time) {
                            createAuditRow(table, this_time, this_price, localize('Start Time'), secondary_classes);
                            has_start_time = true;
                        } else if (is_end_time) {
                            createAuditRow(table, this_time, this_price, localize('End Time'), secondary_classes);
                            has_end_time = true;
                        } else {
                            createAuditRow(table, this_time, this_price);
                        }
                    }
                    resolve();
                }
            });
        })
    );

    const createAuditTable = (title) => {
        const div      = createElement('div', { class: 'audit-table' });
        const fieldset = createElement('fieldset', { class: 'align-start' });
        const table    = createElement('table', { class: 'gr-10 gr-centered gr-12-p gr-12-m' });
        fieldset.appendChild(createElement('legend', { text: localize(`Contract ${title}`) }));
        fieldset.appendChild(table);
        div.appendChild(fieldset);
        let insert_after = document.getElementById('audit_header');
        const audit_table  = document.getElementsByClassName('audit-table')[0];
        if (audit_table) {
            insert_after = audit_table;
        }
        div.insertAfter(insert_after);
        return table;
    };

    const createAuditHeader = (table) => {
        const tr = createElement('tr', { class: 'gr-row' });

        tr.appendChild(createElement('td', { class: 'gr-3' }));
        tr.appendChild(createElement('td', { class: 'gr-4 no-margin secondary-color', text: localize('Spot') }));
        tr.appendChild(createElement('td', { class: 'gr-5 no-margin secondary-color', text: localize('Spot Time') }));

        table.appendChild(tr);
    };

    const createAuditRow = (table, date, tick, remark, td_class) => {
        // if we have already added this timestamp in first table, skip adding it again to second table
        if (document.querySelector(`.audit-dates[data-value='${date}']`)) {
            return;
        }

        const tr        = createElement('tr', { class: 'gr-row' });
        const td_remark = createElement('td', { class: 'gr-3 remark', text: remark });
        const td_tick   = createElement('td', { class: 'gr-4', text: (tick && !isNaN(tick) ? addComma(tick) : tick) });
        const td_date   = createElement('td', { class: 'gr-5 audit-dates', 'data-value': date, 'data-balloon-pos': 'down', text: (date && !isNaN(date) ? moment.utc(+date * 1000).format('YYYY-MM-DD HH:mm:ss') : date) });

        tr.appendChild(td_remark);
        tr.appendChild(td_tick);
        tr.appendChild(td_date);

        if (td_class && td_class.length) {
            td_class.forEach((c) => {
                td_tick.classList.add(c);
                td_date.classList.add(c);
            });
        }

        table.appendChild(tr);
    };

    const populateAuditTable = (show_audit_table) => {
        BinarySocket.send({
            ticks_history: contract.underlying,
            start        : +contract.entry_tick_time - (5 * 60),
            end          : +contract.entry_tick_time + (5 * 60),
        }).then((response_entry) => {
            if (response_entry.error) {
                return;
            }
            appendAuditLink('trade_details_entry_spot');
            appendAuditLink('trade_details_current_spot');
            const table_one = createAuditTable('Starts');
            createAuditHeader(table_one);
            parseTicksResponse(table_one, response_entry, contract.entry_tick_time, 'Entry Spot').then(() => {
                // don't show exit tick information if missing or manual sold
                if (contract.exit_tick_time && !(contract.sell_time && contract.sell_time < contract.date_expiry)) {
                    BinarySocket.send({
                        ticks_history: contract.underlying,
                        start        : +contract.exit_tick_time - (5 * 60),
                        end          : +contract.exit_tick_time + (5 * 60),
                    }).then((response_exit) => {
                        const table_two = createAuditTable('Ends');
                        createAuditHeader(table_two);
                        parseTicksResponse(table_two, response_exit, contract.exit_tick_time, 'Exit Spot');
                    }).then(() => {
                        onAuditTableComplete(show_audit_table);
                    });
                } else {
                    onAuditTableComplete(show_audit_table);
                }
            });
        });
    };

    const onAuditTableComplete = (show_audit_table) => {
        showLocalTimeOnHover('.audit-dates');
        setAuditVisibility(show_audit_table);
    };

    const makeTemplate = () => {
        $container = $('<div/>').append($('<div/>', { id: wrapper_id }));

        const longcode = contract.longcode;

        $container.prepend($('<div/>', { id: 'sell_bet_desc', class: 'popup_bet_desc drag-handle', text: longcode }));
        const $sections  = $('<div/>').append($('<div class="gr-row container"><div id="sell_details_chart_wrapper" class="gr-8 gr-12-m"></div><div id="sell_details_table" class="gr-4 gr-12-m"></div></div>'));
        let barrier_text = 'Barrier';
        if (contract.barrier_count > 1) {
            barrier_text = 'High Barrier';
        } else if (/^DIGIT(MATCH|DIFF)$/.test(contract.contract_type)) {
            barrier_text = 'Target';
        }

        $sections.find('#sell_details_table').append($(
            `<table>
            <tr id="contract_tabs"><th colspan="2" id="contract_information_tab">${localize('Contract Information')}</th></tr><tbody id="contract_information_content">
            ${createRow('Contract ID', '', 'trade_details_contract_id')}
            ${createRow('Reference ID', '', 'trade_details_ref_id')}
            ${createRow('Start Time', '', 'trade_details_start_date')}
            ${(!contract.tick_count ? createRow('End Time', '', 'trade_details_end_date') +
                createRow('Remaining Time', '', 'trade_details_live_remaining') : '')}
            ${createRow('Entry Spot', '', 'trade_details_entry_spot', 0, '<span></span>')}
            ${createRow(barrier_text, '', 'trade_details_barrier', true)}
            ${(contract.barrier_count > 1 ? createRow('Low Barrier', '', 'trade_details_barrier_low', true) : '')}
            ${createRow('Potential Payout', '', 'trade_details_payout')}
            ${createRow('Purchase Price', '', 'trade_details_purchase_price')}
            </tbody>
            <th colspan="2" id="barrier_change" class="invisible">${localize('Barrier Change')}</th>
            <tbody id="barrier_change_content" class="invisible"></tbody>
            <tr><th colspan="2" id="trade_details_current_title">${localize('Current')}</th></tr>
            ${createRow('Spot', 'trade_details_spot_label', 'trade_details_current_spot', 0, '<span></span>')}
            ${createRow('Spot Time', 'trade_details_spottime_label', 'trade_details_current_date')}
            ${createRow('Current Time', '', 'trade_details_live_date')}
            ${createRow('Indicative', 'trade_details_indicative_label', 'trade_details_indicative_price')}
            ${createRow('Profit/Loss', '', 'trade_details_profit_loss')}
            <tr><td colspan="2" class="last_cell" id="trade_details_message">&nbsp;</td></tr>
            </table>
            <div id="errMsg" class="notice-msg ${hidden_class}"></div>
            <div id="trade_details_bottom"><div id="contract_sell_wrapper" class="${hidden_class}"></div><div id="contract_sell_message"></div><div id="contract_win_status" class="${hidden_class}"></div></div>`));

        $sections.find('#sell_details_chart_wrapper').html($('<div/>', { id: (contract.tick_count ? 'tick_chart' : 'analysis_live_chart'), class: 'live_chart_wrapper' }));

        $container.find(`#${wrapper_id}`)
            .append($sections.html())
            .append($('<div/>', { id: 'errMsg', class: `notice-msg ${hidden_class}` }));

        ViewPopupUI.showInpagePopup(`<div class="${popupbox_id}">${$container.html()}</div>`, '', '#sell_bet_desc');
        return $(`#${wrapper_id}`);
    };

    const createRow = (label, label_id, value_id, is_hidden, value) => (
        `<tr${(is_hidden ? ` class="${hidden_class}"` : '')}><td${(label_id ? ` id="${label_id}"` : '')}>${localize(label)}</td><td${(value_id ? ` id="${value_id}"` : '')}>${(value || '')}</td></tr>`
    );

    const epochToDateTime = epoch => moment.utc(epoch * 1000).format('YYYY-MM-DD HH:mm:ss');

    // ===== Tools =====
    const containerSetText = (id, string, attributes, is_visible) => {
        if (!$container || $container.length === 0) {
            $container = $(`#${wrapper_id}`);
        }

        const $target = $container.find(`#${id}`);
        if ($target && $target.length > 0) {
            $target.html(string);
            if (attributes) $target.attr(attributes);
            if (is_visible) $target.parent('tr').setVisibility(1);
        }
    };

    const setLoadingState = (show_loading) => {
        if (show_loading) {
            $loading = $('#trading_init_progress');
            if ($loading.length) {
                $loading.show();
            }
        } else {
            if ($loading.length) {
                $loading.hide();
            }
            if (btn_view) {
                ViewPopupUI.enableButton($(btn_view));
            }
        }
    };

    const showMessagePopup = (message, title, msg_class) => {
        setLoadingState(false);
        const $con = $('<div/>');
        $con.prepend($('<div/>', { id: 'sell_bet_desc', class: 'popup_bet_desc drag-handle', text: localize(title) }));
        $con.append(
            $('<div/>', { id: wrapper_id })
                .append($('<div/>', { class: msg_class, html: localize(message) })));
        ViewPopupUI.showInpagePopup(`<div class="${popupbox_id}">${$con.html()}</div>`, 'message_popup', '#sell_bet_desc');
    };

    const showErrorPopup = (response, message) => {
        showMessagePopup(localize(message || 'Sorry, an error occurred while processing your request.'), 'There was an error', 'notice-msg');
        // eslint-disable-next-line no-console
        console.log(response);
    };

    const sellSetVisibility = (show) => {
        const sell_wrapper_id = 'sell_at_market_wrapper';
        const sell_button_id  = 'sell_at_market';
        const is_exist        = $container.find(`#${sell_wrapper_id}`).length > 0;
        if (show) {
            const is_started    = !contract.is_forward_starting || contract.current_spot_time > contract.date_start;
            const $sell_wrapper = $container.find('#contract_sell_wrapper');
            if (is_exist) {
                if (!sell_text_updated && is_started) {
                    addSellNote($sell_wrapper);
                    $sell_wrapper.find(`#${sell_button_id}`).text(localize('Sell at market'));
                }
                return;
            }

            $sell_wrapper.setVisibility(1)
                .append($('<div/>', { id: sell_wrapper_id })
                    .append($('<button/>', { id: sell_button_id, class: 'button', text: localize(is_started ? 'Sell at market' : 'Sell') })));
            if (is_started) {
                addSellNote($sell_wrapper);
            }

            $container.find(`#${sell_button_id}`).unbind('click').click((e) => {
                e.preventDefault();
                e.stopPropagation();
                is_sell_clicked = true;
                sellSetVisibility(false);
                BinarySocket.send({ sell: contract_id, price: contract.bid_price }).then((response) => {
                    responseSell(response);
                });
            });
        } else {
            if (!is_exist) return;
            $container.find(`#${sell_button_id}`).unbind('click');
            $container.find(`#${sell_wrapper_id}`).remove();
        }
    };

    const addSellNote = ($sell_wrapper) => {
        sell_text_updated = true;
        $sell_wrapper.find('#sell_at_market_wrapper').append($('<div/>', { class: 'note' })
            .append($('<strong/>', { text: `${localize('Note')}: ` }))
            .append($('<span/>', { text: localize('Contract will be sold at the prevailing market price when the request is received by our servers. This price may differ from the indicated price.') })));
    };

    // ===== Requests & Responses =====
    // ----- Get Contract -----
    const getContract = (option) => {
        if (contract_id) {
            ViewPopupUI.forgetStreams();
            const req = {
                contract_id,
                proposal_open_contract: 1,
                subscribe             : 1,
            };
            if (option === 'no-subscribe') delete req.subscribe;
            BinarySocket.send(req, { callback: responseProposal });
        }
    };

    const responseSell = (response) => {
        if (getPropertyValue(response, 'error')) {
            if (response.error.code === 'NoOpenPosition') {
                getContract();
            } else {
                $container.find('#errMsg').text(response.error.message).setVisibility(1);
            }
            sellSetVisibility(true);
            is_sell_clicked = false;
            return;
        }
        ViewPopupUI.forgetStreams();
        $container.find('#errMsg').setVisibility(0);
        sellSetVisibility(false);
        if (is_sell_clicked) {
            containerSetText('contract_sell_message',
                `${localize('You have sold this contract at [_1] [_2]', [contract.currency, response.sell.sold_for])}
                <br />
                ${localize('Your transaction reference number is [_1]', [response.sell.transaction_id])}`);
        }
        getContract('no-subscribe');
    };

    const responseProposal = (response) => {
        if (response.error) {
            if (response.error.code !== 'AlreadySubscribed' && response.echo_req.contract_id === contract_id) {
                showErrorPopup(response, response.error.message);
            }
            return;
        }
        if (response.proposal_open_contract.contract_id === contract_id) {
            ViewPopupUI.storeSubscriptionID(response.proposal_open_contract.id);
            responseContract(response);
        } else {
            BinarySocket.send({ forget: response.proposal_open_contract.id });
        }
        const dates = ['#trade_details_start_date', '#trade_details_end_date', '#trade_details_current_date', '#trade_details_live_date'];
        for (let i = 0; i < dates.length; i++) {
            showLocalTimeOnHover(dates[i]);
            $(dates[i]).attr('data-balloon-pos', 'left');
        }
    };

    const viewButtonOnClick = (container_selector) => {
        $(container_selector).on('click', '.open_contract_details', function (e) {
            e.preventDefault();
            init(this);
        });
    };

    return {
        init,
        viewButtonOnClick,
    };
})();

module.exports = ViewPopup;
