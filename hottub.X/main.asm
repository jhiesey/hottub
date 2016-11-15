#include "p16F1507.inc"

 __CONFIG _CONFIG1, _FOSC_INTOSC & _WDTE_OFF & _PWRTE_ON & _MCLRE_ON & _CP_OFF & _BOREN_ON & _CLKOUTEN_OFF
 __CONFIG _CONFIG2, _WRT_OFF & _STVREN_ON & _BORV_LO & _LPBOR_OFF & _LVP_OFF

;*******************************************************************************
; Reset Vector
;*******************************************************************************

RES_VECT  CODE    0x0000            ; processor reset vector
    GOTO    start                   ; go to beginning of program

;*******************************************************************************
; MAIN PROGRAM
;*******************************************************************************
    
    
GPR_VAR        UDATA_SHR
flowBad RES 1 ; nonzero if flow low or pump not running
pumpTimer RES 1 ; counts down to zero while pumps are on
flowTimer RES 1 ; counts down to zero while flow is low

MAIN_PROG CODE                      ; let linker place main program

#define LOW_FLOW_SECS D'2'
#define CHEM_PUMP_SECS D'60'
 
start
    ; internal osc at 250khz
    banksel OSCCON
    movlw b'00110000'
    movwf OSCCON
    
    banksel LATA
    clrf LATA
    banksel TRISA
    movlw b'00110000'
    movwf TRISA
    banksel ANSELA
    clrf ANSELA
    banksel WPUA
    movwf WPUA
    
    banksel LATB
    clrf LATB
    banksel TRISB
    movlw b'01110000'
    movwf TRISB
    banksel ANSELB
    clrf ANSELB
    banksel WPUB
    movwf WPUB
    
    banksel LATC
    clrf LATC
    banksel TRISC
    movlw b'00000000'
    movwf TRISC
    banksel ANSELC
    clrf ANSELC
    
    ; Timer 0 overflows once per second
    banksel OPTION_REG
    movlw b'00000111'
    movwf OPTION_REG
    
    ; Timer 1 counts flow pulses
    banksel T1CON
    movlw b'10000000'
    movwf T1CON
    
    movlw LOW_FLOW_SECS
    movwf flowTimer
    movlw CHEM_PUMP_SECS
    movwf pumpTimer
    
mainLoop
    ; timer 1 is off. clear it
    banksel T1CON
    clrf TMR1L
    clrf TMR1H
    bsf T1CON, 0
    
    ; clear timer 0
    banksel TMR0
    clrf TMR0
    banksel INTCON
    bcf INTCON, 2

    ; delay until 1 second has expired
delay
    btfss INTCON, 2
    goto delay
    
    ; stop timer 1
    banksel T1CON
    bcf T1CON, 0
    
    ; compare timer 1 to flow limit
    banksel TMR1H
    movf TMR1H
    skpz
    goto goodFlow
    
    movf TMR1L, w
    addlw 0xfa ; 6 counts minimum
    skpnc
    goto goodFlow
    
    banksel LATC
    bcf LATC, 1 ; indicates flow is bad
    
    ; flow is low. decrement timer
    decfsz flowTimer
    goto flowTimerOK
    
    incf flowTimer
    ; timer ran out.
    movlw 1
    movwf flowBad
    goto checkLogic
    
goodFlow
    banksel LATC
    bsf LATC, 1
    movlw LOW_FLOW_SECS
    movwf flowTimer
    
flowTimerOK
    movlw 0
    movwf flowBad
    
checkLogic
    ; logic:
    ; error if
    ; (flow lower than limit for more than time limit, OR circulation pump off)
    ; AND at least one chemical pump is on
    banksel PORTB
    movlw 1
    btfsc PORTB, 5 ; circulation pump
    movwf flowBad
    
    movlw 0
    btfss PORTA, 4 ; chlorine pump
    addlw 1
    btfss PORTB, 4 ; acid pump
    addlw 1
    btfss PORTB, 6 ; base pump
    addlw 1
    
    addlw 0
    skpz
    goto chemicalPumpOn
    movlw CHEM_PUMP_SECS
    movwf pumpTimer
    goto mainLoop ; no pumps on; just loop again
    
chemicalPumpOn
    decf pumpTimer
    skpnz
    goto fail

    addwf flowBad, w
    ; check if more than 1
    addlw 0xfe
    skpc
    goto mainLoop
    
fail
    ; set fail output
    banksel LATC
    bsf LATC, 0
    
deadLoop
    goto deadLoop

    END
