var MBProcess = (function() {
    /*
     * This function process the active symbols to get markets
     * and underlying list
     */
    function processActiveSymbols(data) {
        'use strict';
        if (data.hasOwnProperty('error')) {
            MBNotifications.show({text: data.error.message, uid: 'ACTIVE_SYMBOLS'});
            return;
        }

        // populate the Symbols object
        MBSymbols.details(data);

        var market       = 'major_pairs',
            symbols_list = MBSymbols.underlyings()[market],
            symbol       = MBDefaults.get('underlying'),
            update_page  = MBSymbols.need_page_update();

        if (update_page && (!symbol || !symbols_list[symbol])) {
            symbol = undefined;
        }
        // check if all symbols are inactive
        var is_market_closed = true;
        Object.keys(symbols_list).forEach(function(s) {
            if (symbols_list[s].is_active) {
                is_market_closed = false;
            }
        });
        if (is_market_closed) {
            $('.japan-form, .japan-table, #trading_bottom_content').addClass('invisible');
            MBNotifications.show({text: page.text.localize('Market is closed. Please try again later.'), uid: 'MARKET_CLOSED'});
        } else {
            displayUnderlyings('underlying', symbols_list, symbol);

            if (symbol && !symbols_list[symbol].is_active) {
                MBNotifications.show({text: page.text.localize('This symbol is not active. Please try another symbol.'), uid: 'SYMBOL_INACTIVE'});
            } else if (update_page) {
                MBProcess.processMarketUnderlying();
            }
        }
    }

    /*
     * Function to call when underlying has changed
     */
    function processMarketUnderlying() {
        'use strict';

        var underlyingElement = document.getElementById('underlying');
        if (!underlyingElement) {
            return;
        }

        if(underlyingElement.selectedIndex < 0) {
            underlyingElement.selectedIndex = 0;
        }
        var underlying = underlyingElement.value;
        MBDefaults.set('underlying', underlying);

        showFormOverlay();

        // forget the old tick id i.e. close the old tick stream
        processForgetTicks();
        // get ticks for current underlying
        MBTick.request(underlying);

        MBTick.clean();

        MBTick.updateWarmChart();

        BinarySocket.clearTimeouts();

        MBContract.getContracts(underlying);
    }

    /*
     * Function to process ticks stream
     */
    function processTick(tick) {
        'use strict';
        if (tick.hasOwnProperty('error')) {
            MBNotifications.show({text: tick.error.message, uid: 'TICK_ERROR'});
            return;
        }
        var symbol = MBDefaults.get('underlying');
        if(tick.echo_req.ticks === symbol || (tick.tick && tick.tick.symbol === symbol)){
            MBTick.details(tick);
            MBTick.display();
            MBTick.updateWarmChart();
        }
    }

    /*
     * Function to display contract form for current underlying
     */
    function processContract(contracts) {
        'use strict';

        if (contracts.hasOwnProperty('error')) {
            MBNotifications.show({text: contracts.error.message, uid: contracts.error.code});
            return;
        }

        window.chartAllowed = true;
        if (contracts.contracts_for && contracts.contracts_for.feed_license && contracts.contracts_for.feed_license === 'chartonly') {
            window.chartAllowed = false;
        }
        var noRebuild = contracts.hasOwnProperty('passthrough') &&
                        contracts.passthrough.hasOwnProperty('action') &&
                        contracts.passthrough.action === 'no-proposal';
        MBContract.populateOptions((noRebuild ? null : 'rebuild'));
        if (noRebuild) {
            processExpiredBarriers();
            return;
        }
        processPriceRequest();
        TradingAnalysis.request();
    }

    function processForgetProposals() {
        'use strict';
        MBPrice.showPriceOverlay();
        BinarySocket.send({
            forget_all: "proposal"
        });
        MBPrice.cleanup();
    }

    function processPriceRequest() {
        'use strict';
        MBPrice.increaseReqId();
        processForgetProposals();
        MBPrice.showPriceOverlay();
        var available_contracts = MBContract.getCurrentContracts(),
            durations = MBDefaults.get('period').split('_');
        var req = {
            proposal   : 1,
            subscribe  : 1,
            basis      : 'payout',
            amount     : japanese_client() ? (parseInt(MBDefaults.get('payout')) || 1) * 1000 :
                                              MBDefaults.get('payout'),
            currency   : MBContract.getCurrency(),
            symbol     : MBDefaults.get('underlying'),
            req_id     : MBPrice.getReqId(),
            date_expiry: durations[1],
            trading_period_start: durations[0],
        };
        var barriers_array, i, j, barrier_count, all_expired = true;
        for (i = 0; i < available_contracts.length; i++) {
            req.contract_type = available_contracts[i].contract_type;
            barrier_count = available_contracts[i].barriers == 2 ? 2 : 1;
            barriers_array = available_contracts[i].available_barriers;
            for (j = 0; j < barriers_array.length; j++) {
                if (available_contracts[i].barriers == 2) {
                    req.barrier = barriers_array[j][1];
                    req.barrier2 = barriers_array[j][0];
                    if (barrierHasExpired(available_contracts[i].expired_barriers, req.barrier, req.barrier2)) {
                        continue;
                    }
                } else {
                    req.barrier = barriers_array[j];
                    if (barrierHasExpired(available_contracts[i].expired_barriers, req.barrier)) {
                        continue;
                    }
                }
                all_expired = false;
                MBPrice.addPriceObj(req);
                BinarySocket.send(req);
            }
        }
        if (all_expired) {
            MBNotifications.show({text: page.text.localize('All barriers in this trading window are expired') + '.', uid: 'ALL_EXPIRED'});
        } else {
            MBNotifications.hide('ALL_EXPIRED');
        }
    }

    function processProposal(response) {
        'use strict';
        var req_id = MBPrice.getReqId();
        if(response.req_id === req_id){
            MBPrice.display(response);
            //MBPrice.hidePriceOverlay();
        }
    }

    var periodValue, $countDownTimer, remainingTimeElement, remainingTimeout;
    function processRemainingTime(recalculate) {
        if (typeof periodValue === 'undefined' || recalculate) {
            periodValue = document.getElementById('period').value;
            $countDownTimer = $('.countdown-timer');
            remainingTimeElement = document.getElementById('remaining-time');
        }
        if (!periodValue) return;
        var timeLeft = parseInt(periodValue.split('_')[1]) - window.time.unix();
        if (timeLeft <= 0) {
            location.reload();
        } else if (timeLeft < 120) {
            $countDownTimer.addClass('alert');
        }
        var remainingTimeString = [],
            duration = moment.duration(timeLeft * 1000);
        var all_durations = {
            month  : duration.months(),
            day    : duration.days(),
            hour   : duration.hours(),
            minute : duration.minutes(),
            second : duration.seconds()
        };
        for (var key in all_durations) {
            if (all_durations[key]) {
                remainingTimeString.push(all_durations[key] + page.text.localize((key + (all_durations[key] == 1 ? '' : 's' ))));
            }
        }
        remainingTimeElement.innerHTML = remainingTimeString.join(' ');
        clearRemainingTimeout();
        remainingTimeout = setTimeout(processRemainingTime, 1000);
    }

    function clearRemainingTimeout() {
        clearTimeout(remainingTimeout);
    }

    function processBuy(barrier, contract_type) {
        if (!barrier || !contract_type) return;
        if (!page.client.is_logged_in) {
            MBNotifications.show({text: page.text.localize('Please log in.'), uid: 'LOGIN_ERROR', dismissible: true});
            return;
        }
        MBPrice.showPriceOverlay();
        MBPrice.sendBuyRequest(barrier, contract_type);
    }

    var processExpiredBarriers = function() {
        var contracts = MBContract.getCurrentContracts(),
            i, expired_barrier, expired_barrier_element;
        contracts.forEach(function(c) {
            var expired_barriers = c.expired_barriers;
            for (i = 0; i < c.expired_barriers.length; i++) {
                if (c.barriers == 2) {
                    expired_barrier = c.expired_barriers[i][0] + '_' + c.expired_barriers[i][1];
                } else {
                    expired_barrier = c.expired_barriers[i];
                }
                $expired_barrier_element = $('div [data-barrier="' + expired_barrier + '"]');
                if ($expired_barrier_element.length > 0) {
                    processForgetProposal(expired_barrier);
                    $expired_barrier_element.remove();
                }
            }
        });
    };

    var barrierHasExpired = function(expired_barriers, barrier, barrier2) {
        if (barrier2) {
            return containsArray(expired_barriers, [[barrier2, barrier]]);
        }
        return (expired_barriers.indexOf((barrier).toString()) > -1);
    };

    function processForgetProposal(expired_barrier) {
        var prices = MBPrice.getPrices();
        Object.keys(prices[expired_barrier]).forEach(function(c) {
            if (!prices[expired_barrier][c].hasOwnProperty('error')) {
                BinarySocket.send({forget: prices[expired_barrier][c].proposal.id});
            }
        });
    }

    var containsArray = function(array, val) {
        var hash = {};
        for(var i = 0; i < array.length; i++) {
            hash[array[i]] = i;
        }
        return hash.hasOwnProperty(val);
    };

    return {
        processActiveSymbols   : processActiveSymbols,
        processMarketUnderlying: processMarketUnderlying,
        processTick            : processTick,
        processContract        : processContract,
        processPriceRequest    : processPriceRequest,
        processProposal        : processProposal,
        processRemainingTime   : processRemainingTime,
        processBuy             : processBuy,
        clearTimeout           : clearRemainingTimeout,
    };
})();

module.exports = {
    MBProcess: MBProcess,
};